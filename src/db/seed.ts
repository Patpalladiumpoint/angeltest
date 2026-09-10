#!/usr/bin/env tsx
// Dev-only convenience: seeds an exec user (and optionally recruiters/ops)
// so the app has someone to sign in as via Supabase Auth, plus a small set
// of clearly-labeled FIXTURE mirror rows so the reconciliation dashboard
// (src/db/reconciliation.ts) has something to show locally without a real
// Crelate/QuickBooks pull. These are not real data -- see README.
import { db, queryClient } from "./client";
import { users, client, job, candidate, engagement, placement, invoice } from "./schema";

async function main() {
  const execEmail = process.env.SEED_EXEC_EMAIL;
  if (!execEmail) {
    throw new Error("Set SEED_EXEC_EMAIL to seed an initial exec user");
  }

  const [exec] = await db
    .insert(users)
    .values({ email: execEmail, name: "Exec", role: "exec" })
    .onConflictDoNothing({ target: users.email })
    .returning();
  console.log(`Seeded exec user ${execEmail} (or it already existed).`);

  // SEED_RECRUITER_EMAILS="a@x.com,b@x.com"
  const recruiterEmails = (process.env.SEED_RECRUITER_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);

  const recruiters = [];
  for (const email of recruiterEmails) {
    const [row] = await db
      .insert(users)
      .values({ email, name: email.split("@")[0]!, role: "recruiter" })
      .onConflictDoNothing({ target: users.email })
      .returning();
    console.log(`Seeded recruiter ${email} (or it already existed).`);
    if (row) recruiters.push(row);
  }

  if (process.env.SEED_FIXTURES !== "true") {
    console.log("SEED_FIXTURES not set to true -- skipping fixture mirror rows.");
    return;
  }

  const recruiterId = recruiters[0]?.id ?? exec?.id;

  const [fixtureClient] = await db
    .insert(client)
    .values({ name: "[FIXTURE] Acme Insurance Brokers", tier: "A" })
    .returning();
  if (!fixtureClient) return;

  const [openJob] = await db
    .insert(job)
    .values({ clientId: fixtureClient.id, title: "[FIXTURE] VP, Commercial Lines", status: "open" })
    .returning();
  if (!openJob) return;

  const [candidateOk, candidateNoOwner, candidateDup1, candidateDup2] = await db
    .insert(candidate)
    .values([
      {
        crelateId: "fixture-crelate-001",
        name: "[FIXTURE] Jordan Rivera",
        currentEmployer: "Somewhere Insurance",
        source: "crelate",
      },
      {
        crelateId: "fixture-crelate-002",
        name: "[FIXTURE] Sam Okafor",
        currentEmployer: "Elsewhere Brokerage",
        source: "crelate",
      },
      {
        crelateId: "fixture-crelate-003a",
        name: "[FIXTURE] Pat Delgado",
        currentEmployer: "Duplicate Co",
        source: "crelate",
      },
      {
        crelateId: "fixture-crelate-003b",
        name: "[FIXTURE] Pat Delgado",
        currentEmployer: "Duplicate Co",
        source: "crelate",
      },
    ])
    .returning();

  if (candidateOk && openJob) {
    // A normal, owned engagement -- should NOT show up in any reconciliation
    // finding.
    const [okEngagement] = await db
      .insert(engagement)
      .values({
        candidateId: candidateOk.id,
        jobId: openJob.id,
        currentStage: "submitted_to_client",
        ownerUserId: recruiterId,
        status: "active",
      })
      .returning();

    if (okEngagement) {
      const [placed] = await db
        .insert(placement)
        .values({ engagementId: okEngagement.id, status: "confirmed", feeAmount: "45000.00" })
        .returning();

      if (placed) {
        // Invoice with no placement_id link -- deliberate (see
        // 0003_phase0_mirror.sql): Phase 0 never populates this link, so
        // this row demonstrates the exact finding the dashboard exists to
        // surface, even for an otherwise-healthy placement.
        await db.insert(invoice).values({
          quickbooksId: "fixture-qb-inv-001",
          amount: "45000.00",
          status: "open",
        });
      }
    }
  }

  if (candidateNoOwner && openJob) {
    // Engagement with no owner -- a real Phase 0 finding.
    await db.insert(engagement).values({
      candidateId: candidateNoOwner.id,
      jobId: openJob.id,
      currentStage: "identified",
      status: "active",
    });
  }

  // A placement with no fee at all -- another real Phase 0 finding.
  if (candidateDup1 && openJob) {
    const [unfeeEngagement] = await db
      .insert(engagement)
      .values({
        candidateId: candidateDup1.id,
        jobId: openJob.id,
        currentStage: "started",
        ownerUserId: recruiterId,
        status: "active",
      })
      .returning();
    if (unfeeEngagement) {
      await db.insert(placement).values({ engagementId: unfeeEngagement.id, status: "pending" });
    }
  }

  console.log(
    "Seeded fixture client/job/candidates/engagements/placement/invoice " +
      "(candidateDup1/candidateDup2 share a name+employer on purpose, to " +
      "exercise the duplicate-candidate finding).",
  );
  void candidateDup2;
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => queryClient.end());
