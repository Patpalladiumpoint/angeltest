// Documents: Supabase Storage, signed URLs only (spec section 2, section 6:
// "no public buckets, ever"). Server-side client uses the service role key
// -- never exposed to the browser -- so every read/write goes through
// application code that can enforce who's allowed to touch a given
// document_file row, rather than handing out a bucket credential.
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";

const DOCUMENTS_BUCKET = process.env.DOCUMENTS_BUCKET ?? "documents";
const SIGNED_URL_TTL_SECONDS = 300; // short expiry, section 6

function client() {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, serviceRoleKey, { auth: { persistSession: false } });
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export async function uploadDocument(params: {
  storagePath: string;
  body: Buffer;
  contentType: string;
}): Promise<{ checksumSha256: string }> {
  const { error } = await client()
    .storage.from(DOCUMENTS_BUCKET)
    .upload(params.storagePath, params.body, { contentType: params.contentType, upsert: false });
  if (error) throw new Error(`document upload failed: ${error.message}`);
  return { checksumSha256: sha256(params.body) };
}

export async function getDocumentSignedUrl(storagePath: string): Promise<string> {
  const { data, error } = await client().storage.from(DOCUMENTS_BUCKET).createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
  if (error || !data) throw new Error(`could not create signed URL: ${error?.message}`);
  return data.signedUrl;
}

export async function deleteDocument(storagePath: string): Promise<void> {
  const { error } = await client().storage.from(DOCUMENTS_BUCKET).remove([storagePath]);
  if (error) throw new Error(`document delete failed: ${error.message}`);
}
