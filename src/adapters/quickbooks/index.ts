import { createHash } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { db } from "@/db/client";
import { invoice, payment, syncRecord } from "@/db/schema";
import { recordEvent } from "@/db/eventLog";
import type { Adapter, HealthCheckResult, PullResult, PushResult, ReconcileResult } from "../types";
import { loadQuickBooksConfig, QuickBooksClient } from "./client";
import { withRetry } from "../retry";

const SYSTEM = "quickbooks";

interface QboInvoice {
  Id: string;
  TotalAmt?: number;
  TxnDate?: string;
  DueDate?: string;
  Balance?: number;
}

interface QboPayment {
  Id: string;
  TotalAmt?: number;
  TxnDate?: string;
  LinkedTxn?: { TxnId: string; TxnType: string }[];
}

function hashPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

async function upsertSyncRecord(input: {
  externalId: string;
  internalEntity: string;
  internalId: string;
  hash: string;
}): Promise<void> {
  await db
    .insert(syncRecord)
    .values({
      system: SYSTEM,
      externalId: input.externalId,
      internalEntity: input.internalEntity,
      internalId: input.internalId,
      lastPulledAt: new Date(),
      lastHash: input.hash,
    })
    .onConflictDoUpdate({
      target: [syncRecord.system, syncRecord.externalId, syncRecord.internalEntity],
      set: { internalId: input.internalId, lastPulledAt: new Date(), lastHash: input.hash },
    });
}

export const quickbooksAdapter: Adapter = {
  system: SYSTEM,

  async healthCheck(): Promise<HealthCheckResult> {
    const config = loadQuickBooksConfig();
    if (!config) {
      return {
        system: SYSTEM,
        status: "not_configured",
        ok: false,
        detail:
          "QUICKBOOKS_CLIENT_ID / QUICKBOOKS_CLIENT_SECRET / QUICKBOOKS_REFRESH_TOKEN / " +
          "QUICKBOOKS_REALM_ID are not all set. This adapter is fully implemented against " +
          "Intuit's documented API -- it just has no connected app to call yet.",
        checkedAt: new Date(),
      };
    }

    try {
      const client = new QuickBooksClient(config);
      const info = await client.companyInfo();
      return {
        system: SYSTEM,
        status: info ? "ok" : "error",
        ok: Boolean(info),
        detail: info
          ? `Connected to ${config.environment} realm ${config.realmId} (${String(info.CompanyName ?? "unnamed")}).`
          : `CompanyInfo request to ${config.environment} realm ${config.realmId} returned no data.`,
        checkedAt: new Date(),
      };
    } catch (err) {
      return {
        system: SYSTEM,
        status: "error",
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
        checkedAt: new Date(),
      };
    }
  },

  async pull(mode): Promise<PullResult> {
    const startedAt = new Date();
    const config = loadQuickBooksConfig();
    const errors: string[] = [];

    if (!config) {
      await recordEvent({
        type: "integration_blocked",
        source: SYSTEM,
        payload: { method: "pull", reason: "not_configured" },
        occurredAt: startedAt,
      });
      return {
        system: SYSTEM,
        mode,
        recordsFetched: 0,
        recordsUpserted: 0,
        eventsWritten: 1,
        startedAt,
        finishedAt: new Date(),
        blocked: true,
        blockedReason: "QuickBooks OAuth credentials/realm are not configured.",
        errors,
      };
    }

    if (mode === "dry") {
      // Hard rule 2: dry mode logs the intended payload/queries and
      // returns a simulated result -- no network call, no DB write.
      const intendedQueries = [
        "select * from Invoice startposition 1 maxresults 1000",
        "select * from Payment startposition 1 maxresults 1000",
      ];
      await recordEvent({
        type: "adapter_dry_run",
        source: SYSTEM,
        payload: { method: "pull", realmId: config.realmId, intendedQueries },
        occurredAt: startedAt,
      });
      return {
        system: SYSTEM,
        mode,
        recordsFetched: 0,
        recordsUpserted: 0,
        eventsWritten: 1,
        startedAt,
        finishedAt: new Date(),
        blocked: false,
        errors,
      };
    }

    const client = new QuickBooksClient(config);
    let recordsFetched = 0;
    let recordsUpserted = 0;
    let eventsWritten = 0;

    try {
      const invoices = await withRetry(() => client.query<QboInvoice>("select * from Invoice"));
      recordsFetched += invoices.length;

      for (const qbInvoice of invoices) {
        await recordEvent({
          type: "quickbooks.invoice",
          source: SYSTEM,
          entityType: "invoice",
          entityId: qbInvoice.Id,
          payload: qbInvoice,
          occurredAt: startedAt,
          externalId: `quickbooks:invoice:${qbInvoice.Id}`,
        });
        eventsWritten += 1;

        const [row] = await db
          .insert(invoice)
          .values({
            quickbooksId: qbInvoice.Id,
            amount: String(qbInvoice.TotalAmt ?? 0),
            status: (qbInvoice.Balance ?? 0) > 0 ? "open" : "paid",
            issuedAt: qbInvoice.TxnDate ? new Date(qbInvoice.TxnDate) : undefined,
            dueAt: qbInvoice.DueDate ? new Date(qbInvoice.DueDate) : undefined,
          })
          .onConflictDoUpdate({
            target: invoice.quickbooksId,
            set: {
              amount: String(qbInvoice.TotalAmt ?? 0),
              status: (qbInvoice.Balance ?? 0) > 0 ? "open" : "paid",
              updatedAt: new Date(),
            },
          })
          .returning();

        if (row) {
          recordsUpserted += 1;
          await upsertSyncRecord({
            externalId: qbInvoice.Id,
            internalEntity: "invoice",
            internalId: row.id,
            hash: hashPayload(qbInvoice),
          });
        }
      }

      const payments = await withRetry(() => client.query<QboPayment>("select * from Payment"));
      recordsFetched += payments.length;

      for (const qbPayment of payments) {
        await recordEvent({
          type: "quickbooks.payment",
          source: SYSTEM,
          entityType: "payment",
          entityId: qbPayment.Id,
          payload: qbPayment,
          occurredAt: startedAt,
          externalId: `quickbooks:payment:${qbPayment.Id}`,
        });
        eventsWritten += 1;

        const linkedInvoiceId = qbPayment.LinkedTxn?.find((t) => t.TxnType === "Invoice")?.TxnId;
        let invoiceRowId: string | undefined;
        if (linkedInvoiceId) {
          const [linked] = await db
            .select({ id: invoice.id })
            .from(invoice)
            .where(eq(invoice.quickbooksId, linkedInvoiceId));
          invoiceRowId = linked?.id;
        }

        const [row] = await db
          .insert(payment)
          .values({
            quickbooksId: qbPayment.Id,
            invoiceId: invoiceRowId,
            amount: String(qbPayment.TotalAmt ?? 0),
            receivedAt: qbPayment.TxnDate ? new Date(qbPayment.TxnDate) : new Date(),
          })
          .onConflictDoUpdate({
            target: payment.quickbooksId,
            set: { invoiceId: invoiceRowId, amount: String(qbPayment.TotalAmt ?? 0) },
          })
          .returning();

        if (row) {
          recordsUpserted += 1;
          await upsertSyncRecord({
            externalId: qbPayment.Id,
            internalEntity: "payment",
            internalId: row.id,
            hash: hashPayload(qbPayment),
          });
        }
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
      await recordEvent({
        type: "adapter_pull_failed",
        source: SYSTEM,
        payload: { error: errors[errors.length - 1] },
        occurredAt: new Date(),
      });
    }

    return {
      system: SYSTEM,
      mode,
      recordsFetched,
      recordsUpserted,
      eventsWritten,
      startedAt,
      finishedAt: new Date(),
      blocked: false,
      errors,
    };
  },

  async push(mode): Promise<PushResult> {
    // Spec section 7, Phase 0: "Read only. Zero writes to any external
    // system." Invoice creation is explicitly Phase 1 (spec 7, "Invoice
    // creation pushed to QuickBooks (dry run first, then live)"). This is
    // a phase-gate refusal, not a missing-credentials one -- push() stays
    // blocked here even once QuickBooks is fully connected, until Phase 1
    // actually ships.
    const now = new Date();
    await recordEvent({
      type: "integration_blocked",
      source: SYSTEM,
      payload: { method: "push", reason: "Phase 0 is read-only; invoice push is Phase 1 scope." },
      occurredAt: now,
    });
    return {
      system: SYSTEM,
      mode,
      recordsPushed: 0,
      startedAt: now,
      finishedAt: now,
      blocked: true,
      blockedReason: "Phase 0 is read-only. QuickBooks writes ship in Phase 1.",
      errors: [],
    };
  },

  async reconcile(): Promise<ReconcileResult> {
    const startedAt = new Date();
    const config = loadQuickBooksConfig();
    if (!config) {
      return {
        system: SYSTEM,
        driftFound: 0,
        startedAt,
        finishedAt: new Date(),
        details: ["QuickBooks not configured -- nothing to reconcile against."],
      };
    }

    const client = new QuickBooksClient(config);
    const details: string[] = [];
    let driftFound = 0;

    try {
      const [remoteInvoiceCount, localInvoiceCount] = await Promise.all([
        withRetry(() => client.count("Invoice")),
        db
          .select({ id: syncRecord.id })
          .from(syncRecord)
          .where(and(eq(syncRecord.system, SYSTEM), eq(syncRecord.internalEntity, "invoice")))
          .then((rows) => rows.length),
      ]);

      if (remoteInvoiceCount !== localInvoiceCount) {
        driftFound += 1;
        details.push(
          `QuickBooks reports ${remoteInvoiceCount} invoices; local mirror has ${localInvoiceCount}. Run pull('live') to resync.`,
        );
      }
    } catch (err) {
      details.push(`Reconcile check failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    return { system: SYSTEM, driftFound, startedAt, finishedAt: new Date(), details };
  },
};
