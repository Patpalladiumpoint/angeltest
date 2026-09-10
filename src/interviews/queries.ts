// Interviews module (section 9). Views are separate concrete queries (not
// composed sql`` fragments) for the same reason as src/tasks/queries.ts.
import { sql, eq } from "drizzle-orm";
import { db, withActor, type Actor, type DbTx } from "@/db/client";
import { interview, interviewParticipant } from "@/db/schema";
import { writeAuditLog } from "@/audit/log";
import { writeEvent } from "@/events/writer";
import { createInterviewCompletionTasks } from "@/domain/transitions";

export type InterviewRow = {
  id: string;
  engagementId: string;
  personName: string;
  jobTitle: string;
  clientName: string;
  roundNumber: number;
  interviewType: string;
  scheduledAt: Date | null;
  status: string;
  candidateFeedback: string | null;
  clientFeedback: string | null;
};

const BASE_SELECT = `
  SELECT iv.id, iv.engagement_id, p.primary_name AS person_name, j.title AS job_title, b.name AS client_name,
         iv.round_number, iv.interview_type::text, iv.scheduled_at, iv.status::text,
         iv.candidate_feedback, iv.client_feedback
  FROM interview iv
  JOIN engagement e ON e.id = iv.engagement_id
  JOIN person p ON p.id = e.person_id
  JOIN job j ON j.id = e.job_id
  JOIN client c ON c.id = j.client_id
  JOIN brokerage b ON b.id = c.brokerage_id
`;

type RawRow = {
  id: string;
  engagement_id: string;
  person_name: string;
  job_title: string;
  client_name: string;
  round_number: number;
  interview_type: string;
  scheduled_at: Date | null;
  status: string;
  candidate_feedback: string | null;
  client_feedback: string | null;
};

function mapRow(r: RawRow): InterviewRow {
  return {
    id: r.id,
    engagementId: r.engagement_id,
    personName: r.person_name,
    jobTitle: r.job_title,
    clientName: r.client_name,
    roundNumber: r.round_number,
    interviewType: r.interview_type,
    scheduledAt: r.scheduled_at,
    status: r.status,
    candidateFeedback: r.candidate_feedback,
    clientFeedback: r.client_feedback,
  };
}

export async function listInterviewsToday(): Promise<InterviewRow[]> {
  const rows = await db.execute<RawRow>(
    sql.raw(`${BASE_SELECT} WHERE iv.status = 'scheduled' AND iv.scheduled_at::date = current_date ORDER BY iv.scheduled_at ASC`),
  );
  return rows.map(mapRow);
}

export async function listUpcomingInterviews(): Promise<InterviewRow[]> {
  const rows = await db.execute<RawRow>(
    sql.raw(`${BASE_SELECT} WHERE iv.status = 'scheduled' AND iv.scheduled_at > now() ORDER BY iv.scheduled_at ASC`),
  );
  return rows.map(mapRow);
}

export async function listAwaitingCandidateDebrief(): Promise<InterviewRow[]> {
  const rows = await db.execute<RawRow>(
    sql.raw(`${BASE_SELECT} WHERE iv.status = 'completed' AND iv.candidate_feedback IS NULL ORDER BY iv.scheduled_at DESC`),
  );
  return rows.map(mapRow);
}

export async function listAwaitingClientFeedback(): Promise<InterviewRow[]> {
  const rows = await db.execute<RawRow>(
    sql.raw(`${BASE_SELECT} WHERE iv.status = 'completed' AND iv.client_feedback IS NULL ORDER BY iv.scheduled_at DESC`),
  );
  return rows.map(mapRow);
}

export async function listCompletedInterviews(): Promise<InterviewRow[]> {
  const rows = await db.execute<RawRow>(sql.raw(`${BASE_SELECT} WHERE iv.status = 'completed' ORDER BY iv.scheduled_at DESC LIMIT 100`));
  return rows.map(mapRow);
}

export async function listCanceledInterviews(): Promise<InterviewRow[]> {
  const rows = await db.execute<RawRow>(
    sql.raw(`${BASE_SELECT} WHERE iv.status IN ('canceled', 'rescheduled') ORDER BY iv.scheduled_at DESC LIMIT 100`),
  );
  return rows.map(mapRow);
}

export async function scheduleInterview(
  input: {
    engagementId: string;
    roundNumber: number;
    interviewType: "sendout" | "follow_up" | "final" | "debrief" | "other";
    scheduledAt: Date;
    meetingUrl?: string;
  },
  actor: Actor,
): Promise<string> {
  return withActor(actor, async (tx) => {
    const [created] = await tx
      .insert(interview)
      .values({
        engagementId: input.engagementId,
        roundNumber: input.roundNumber,
        interviewType: input.interviewType,
        scheduledAt: input.scheduledAt,
        meetingUrl: input.meetingUrl,
        ownerUserId: actor.userId,
        createdBy: actor.userId,
      })
      .returning({ id: interview.id });

    await writeEvent(tx, {
      type: "interview.scheduled",
      source: "manual_ui",
      entityType: "interview",
      entityId: created!.id,
      payload: input,
      occurredAt: new Date(),
    });

    return created!.id;
  });
}

export async function markInterviewCompleted(interviewId: string, actor: Actor): Promise<void> {
  await withActor(actor, async (tx) => {
    const [before] = await tx.select().from(interview).where(eq(interview.id, interviewId)).limit(1);
    if (!before) throw new Error("interview not found");

    await tx.update(interview).set({ status: "completed" }).where(eq(interview.id, interviewId));

    // Section 10's third worked example: completing an interview opens
    // both a candidate-debrief and a client-feedback SLA task.
    await createInterviewCompletionTasks(tx, before.engagementId, before.ownerUserId);

    await writeAuditLog(tx, {
      actorUserId: actor.userId,
      action: "complete_interview",
      entityType: "interview",
      entityId: interviewId,
      before,
      after: { status: "completed" },
    });
  });
}

export async function recordInterviewFeedback(
  interviewId: string,
  side: "candidate" | "client",
  feedback: string,
  actor: Actor,
): Promise<void> {
  await withActor(actor, async (tx: DbTx) => {
    if (side === "candidate") {
      await tx
        .update(interview)
        .set({ candidateFeedback: feedback, candidateFeedbackReceivedAt: new Date() })
        .where(eq(interview.id, interviewId));
    } else {
      await tx
        .update(interview)
        .set({ clientFeedback: feedback, clientFeedbackReceivedAt: new Date() })
        .where(eq(interview.id, interviewId));
    }
  });
}

export async function addInterviewParticipant(
  interviewId: string,
  participant: { appUserId?: string; externalName?: string; externalEmail?: string; role: string },
): Promise<void> {
  await db.insert(interviewParticipant).values({
    interviewId,
    appUserId: participant.appUserId,
    externalName: participant.externalName,
    externalEmail: participant.externalEmail,
    role: participant.role,
  });
}
