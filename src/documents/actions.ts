"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { candidates, documents, auditLog } from "@/db/schema";
import { requireUser } from "@/auth/requireAdmin";
import { documentsBucket, documentsClient, putObject } from "@/storage/s3";
import type { ActionResult } from "@/lib/actions";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

// Spec 3.7: "Documents in S3-compatible storage with versioning and
// server-side encryption. Never on the app filesystem." Phase 3 scope is
// upload and view -- parsing (spec 6.3, text extraction + LLM structured
// extraction) is Phase 7 and deliberately not started here; parse_status
// stays "pending" until that phase exists to act on it.
export async function uploadDocumentAction(formData: FormData): Promise<ActionResult> {
  const session = await requireUser();
  const candidateId = String(formData.get("candidateId") ?? "");
  const docType = String(formData.get("docType") ?? "attachment") as "resume" | "attachment" | "note_file";
  const file = formData.get("file");

  if (!candidateId) return { ok: false, error: "Missing candidate" };
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a file to upload" };
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: `File is too large (max ${MAX_UPLOAD_BYTES / 1024 / 1024} MB)` };
  }

  const [candidate] = await db.select().from(candidates).where(eq(candidates.id, candidateId));
  if (!candidate) return { ok: false, error: "Candidate not found" };

  const buffer = Buffer.from(await file.arrayBuffer());
  // Random key, not the filename -- avoids path traversal / weird-character
  // issues and collisions; the original filename is preserved separately
  // for display and download.
  const storageKey = `candidates/${candidateId}/${randomUUID()}-${sanitizeFilename(file.name)}`;

  const { checksumSha256 } = await putObject({
    client: documentsClient,
    bucket: documentsBucket(),
    key: storageKey,
    body: buffer,
    contentType: file.type || "application/octet-stream",
  });

  const [document] = await db
    .insert(documents)
    .values({
      candidateId,
      docType,
      storageKey,
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: buffer.length,
      checksumSha256,
      // Only a resume is ever going to get text-extracted (Phase 7); other
      // attachment types have nothing to parse.
      parseStatus: docType === "resume" ? "pending" : "not_applicable",
      uploadedBy: session.user.id,
    })
    .returning({ id: documents.id });

  await db.insert(auditLog).values({
    actorUserId: session.user.id,
    entityType: "document",
    entityId: document!.id,
    action: "create",
    after: { candidateId, docType, filename: file.name, sizeBytes: buffer.length, checksumSha256 },
  });

  revalidatePath(`/candidates/${candidateId}`);
  return { ok: true };
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
}
