import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth/config";
import { db } from "@/db/client";
import { documents } from "@/db/schema";
import { documentsBucket, documentsClient, getObjectBuffer } from "@/storage/s3";

// Streams the object through the app rather than a presigned URL --
// avoids adding @aws-sdk/s3-request-presigner as a dependency for what's
// otherwise a one-file reuse of getObjectBuffer() (already built for
// backup/export in Phase 0). Fine at this scale; revisit if document
// volume ever makes proxying through the app a real bottleneck.
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const [doc] = await db.select().from(documents).where(eq(documents.id, params.id));
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const buffer = await getObjectBuffer({
    client: documentsClient,
    bucket: documentsBucket(),
    key: doc.storageKey,
  });

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": doc.mimeType,
      "Content-Disposition": `attachment; filename="${doc.filename.replace(/"/g, "")}"`,
      "Content-Length": String(buffer.length),
    },
  });
}
