import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, ForbiddenError, UnauthorizedError } from "@/auth/requireAdmin";
import { isOutboundEnabled, setOutboundEnabled } from "@/settings/outbound";

// "One button in admin" (spec 3.1). GET reads current state for the toggle
// UI; POST flips it. Both require admin -- a recruiter can trigger a halt by
// asking, never unilaterally, since disabling outbound for the whole desk is
// a shared-impact action.
export async function GET() {
  try {
    await requireAdmin();
  } catch (err) {
    return unauthorizedResponse(err);
  }
  return NextResponse.json({ outboundEnabled: await isOutboundEnabled() });
}

const toggleSchema = z.object({
  enabled: z.boolean(),
  reason: z.string().min(1, "A reason is required to change the kill switch"),
});

export async function POST(request: Request) {
  let session;
  try {
    session = await requireAdmin();
  } catch (err) {
    return unauthorizedResponse(err);
  }

  const parsed = toggleSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  await setOutboundEnabled({
    enabled: parsed.data.enabled,
    actorUserId: session.user.id,
    reason: parsed.data.reason,
  });

  return NextResponse.json({ outboundEnabled: parsed.data.enabled });
}

function unauthorizedResponse(err: unknown) {
  if (err instanceof UnauthorizedError) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
  if (err instanceof ForbiddenError) {
    return NextResponse.json({ error: "Admin role required" }, { status: 403 });
  }
  throw err;
}
