// S3-compatible client for the backups bucket only (documents use Supabase
// Storage's own JS client -- src/storage/documents.ts -- per spec section
// 2's specific naming of "Supabase Storage" for documents). Backups need
// pg_dump-sized binary transfer and must live in a separate
// account/region from the primary DB (spec section 6); Supabase Storage's
// S3-compatible protocol serves that without a second product.
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";

function buildClient(): S3Client {
  const endpoint = process.env.BACKUPS_S3_ENDPOINT;
  const region = process.env.BACKUPS_S3_REGION ?? "us-east-1";
  const accessKeyId = process.env.BACKUPS_S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.BACKUPS_S3_SECRET_ACCESS_KEY;

  return new S3Client({
    region,
    endpoint: endpoint || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined,
  });
}

export const backupsClient = buildClient();
export const backupsBucket = () => requireEnv("BACKUPS_BUCKET");

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export async function putObject(params: {
  bucket: string;
  key: string;
  body: Buffer;
  contentType?: string;
}): Promise<{ checksumSha256: string }> {
  const checksumSha256 = createHash("sha256").update(params.body).digest("hex");
  await backupsClient.send(
    new PutObjectCommand({
      Bucket: params.bucket,
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
      ServerSideEncryption: "AES256",
    }),
  );
  return { checksumSha256 };
}

export async function getObjectBuffer(params: { bucket: string; key: string }): Promise<Buffer> {
  const result = await backupsClient.send(new GetObjectCommand({ Bucket: params.bucket, Key: params.key }));
  const stream = result.Body as Readable;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function listObjectsWithMetadata(params: {
  bucket: string;
  prefix: string;
}): Promise<Array<{ key: string; lastModified: Date | undefined }>> {
  const objects: Array<{ key: string; lastModified: Date | undefined }> = [];
  let continuationToken: string | undefined;

  do {
    const result = await backupsClient.send(
      new ListObjectsV2Command({ Bucket: params.bucket, Prefix: params.prefix, ContinuationToken: continuationToken }),
    );
    for (const obj of result.Contents ?? []) {
      if (obj.Key) objects.push({ key: obj.Key, lastModified: obj.LastModified });
    }
    continuationToken = result.NextContinuationToken;
  } while (continuationToken);

  return objects;
}

export async function deleteObject(params: { bucket: string; key: string }): Promise<void> {
  await backupsClient.send(new DeleteObjectCommand({ Bucket: params.bucket, Key: params.key }));
}
