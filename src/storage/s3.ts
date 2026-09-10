import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";

// Two independent S3-compatible endpoints, deliberately not shared:
//   - documents bucket: candidate resumes/attachments (spec 3.7, "Documents
//     in S3-compatible storage with versioning and server-side encryption.
//     Never on the app filesystem.")
//   - backups bucket: nightly logical backups, required to live in a
//     different account/region than the primary DB and the documents bucket
//     (spec 3.7). Sharing one client here would make that separation easy to
//     accidentally erode later, so each gets its own client and its own env
//     vars from the start.
function buildClient(prefix: "S3" | "BACKUPS_S3"): S3Client {
  const endpoint = process.env[`${prefix}_ENDPOINT`];
  const region = process.env[`${prefix}_REGION`] ?? "us-east-1";
  const accessKeyId = process.env[`${prefix}_ACCESS_KEY_ID`];
  const secretAccessKey = process.env[`${prefix}_SECRET_ACCESS_KEY`];

  return new S3Client({
    region,
    endpoint: endpoint || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    credentials:
      accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined,
  });
}

export const documentsClient = buildClient("S3");
export const backupsClient = buildClient("BACKUPS_S3");

export const documentsBucket = () => requireEnv("DOCUMENTS_BUCKET");
export const backupsBucket = () => requireEnv("BACKUPS_BUCKET");

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export async function putObject(params: {
  client: S3Client;
  bucket: string;
  key: string;
  body: Buffer;
  contentType?: string;
}): Promise<{ checksumSha256: string }> {
  const checksumSha256 = createHash("sha256").update(params.body).digest("hex");

  await params.client.send(
    new PutObjectCommand({
      Bucket: params.bucket,
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
      // Server-side encryption per spec 3.7. Bucket-level versioning is
      // provisioning, not application code -- see README custody section.
      ServerSideEncryption: "AES256",
    }),
  );

  return { checksumSha256 };
}

export async function getObjectBuffer(params: {
  client: S3Client;
  bucket: string;
  key: string;
}): Promise<Buffer> {
  const result = await params.client.send(
    new GetObjectCommand({ Bucket: params.bucket, Key: params.key }),
  );
  const stream = result.Body as Readable;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function objectExists(params: {
  client: S3Client;
  bucket: string;
  key: string;
}): Promise<boolean> {
  try {
    await params.client.send(new HeadObjectCommand({ Bucket: params.bucket, Key: params.key }));
    return true;
  } catch {
    return false;
  }
}

export async function listObjectKeys(params: {
  client: S3Client;
  bucket: string;
  prefix: string;
}): Promise<string[]> {
  return (await listObjectsWithMetadata(params)).map((obj) => obj.key);
}

export async function listObjectsWithMetadata(params: {
  client: S3Client;
  bucket: string;
  prefix: string;
}): Promise<Array<{ key: string; lastModified: Date | undefined; sizeBytes: number | undefined }>> {
  const objects: Array<{ key: string; lastModified: Date | undefined; sizeBytes: number | undefined }> = [];
  let continuationToken: string | undefined;

  do {
    const result = await params.client.send(
      new ListObjectsV2Command({
        Bucket: params.bucket,
        Prefix: params.prefix,
        ContinuationToken: continuationToken,
      }),
    );
    for (const obj of result.Contents ?? []) {
      if (obj.Key) objects.push({ key: obj.Key, lastModified: obj.LastModified, sizeBytes: obj.Size });
    }
    continuationToken = result.NextContinuationToken;
  } while (continuationToken);

  return objects;
}

export function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}
