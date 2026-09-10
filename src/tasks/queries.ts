// Tasks / Action Queue (section 10). Every view here is a filter over the
// same underlying task table extended in migration 0012 -- "Mine", "Team",
// "Due Today", "Overdue", and the category-based views are all the same
// shape of query with a different WHERE clause. Written as separate
// concrete queries per view (not one query built by composing conditional
// sql`` fragments) -- this sandbox has no way to execute the drizzle
// driver, so every query here uses only the flat-template-with-
// interpolated-parameters pattern already proven repeatedly elsewhere in
// this codebase, rather than a fragment-composition API this session
// cannot verify end to end.
import { sql, eq } from "drizzle-orm";
import { db, withActor, type Actor } from "@/db/client";
import { task } from "@/db/schema";
import { writeAuditLog } from "@/audit/log";

export type TaskRow = {
  id: string;
  type: string;
  category: string;
  priority: string;
  slaZone: string | null;
  notes: string | null;
  dueAt: Date | null;
  completedAt: Date | null;
  assigneeName: string | null;
  entityType: string | null;
  entityId: string | null;
  entityLabel: string | null;
};

type RawTaskRow = {
  id: string;
  type: string;
  category: string;
  priority: string;
  sla_zone: string | null;
  notes: string | null;
  due_at: Date | null;
  completed_at: Date | null;
  assignee_name: string | null;
  entity_type: string | null;
  entity_id: string | null;
  entity_label: string | null;
};

function mapRow(r: RawTaskRow): TaskRow {
  return {
    id: r.id,
    type: r.type,
    category: r.category,
    priority: r.priority,
    slaZone: r.sla_zone,
    notes: r.notes,
    dueAt: r.due_at,
    completedAt: r.completed_at,
    assigneeName: r.assignee_name,
    entityType: r.entity_type,
    entityId: r.entity_id,
    entityLabel: r.entity_label,
  };
}

export async function listMyTasks(assigneeUserId: string): Promise<TaskRow[]> {
  const rows = await db.execute<RawTaskRow>(sql`
    SELECT t.id, t.type, t.category::text, t.priority::text, t.sla_zone::text AS sla_zone, t.notes,
           t.due_at, t.completed_at, u.name AS assignee_name, t.entity_type, t.entity_id,
           CASE WHEN t.entity_type = 'engagement' THEN p.primary_name || ' — ' || j.title ELSE NULL END AS entity_label
    FROM task t
    LEFT JOIN app_user u ON u.id = t.assignee_user_id
    LEFT JOIN engagement e ON t.entity_type = 'engagement' AND e.id = t.entity_id::uuid
    LEFT JOIN person p ON p.id = e.person_id
    LEFT JOIN job j ON j.id = e.job_id
    WHERE t.completed_at IS NULL AND t.assignee_user_id = ${assigneeUserId}
    ORDER BY t.due_at ASC NULLS LAST
  `);
  return rows.map(mapRow);
}

export async function listTeamTasks(): Promise<TaskRow[]> {
  const rows = await db.execute<RawTaskRow>(sql`
    SELECT t.id, t.type, t.category::text, t.priority::text, t.sla_zone::text AS sla_zone, t.notes,
           t.due_at, t.completed_at, u.name AS assignee_name, t.entity_type, t.entity_id,
           CASE WHEN t.entity_type = 'engagement' THEN p.primary_name || ' — ' || j.title ELSE NULL END AS entity_label
    FROM task t
    LEFT JOIN app_user u ON u.id = t.assignee_user_id
    LEFT JOIN engagement e ON t.entity_type = 'engagement' AND e.id = t.entity_id::uuid
    LEFT JOIN person p ON p.id = e.person_id
    LEFT JOIN job j ON j.id = e.job_id
    WHERE t.completed_at IS NULL
    ORDER BY t.due_at ASC NULLS LAST
  `);
  return rows.map(mapRow);
}

export async function listDueTodayTasks(): Promise<TaskRow[]> {
  const rows = await db.execute<RawTaskRow>(sql`
    SELECT t.id, t.type, t.category::text, t.priority::text, t.sla_zone::text AS sla_zone, t.notes,
           t.due_at, t.completed_at, u.name AS assignee_name, t.entity_type, t.entity_id,
           CASE WHEN t.entity_type = 'engagement' THEN p.primary_name || ' — ' || j.title ELSE NULL END AS entity_label
    FROM task t
    LEFT JOIN app_user u ON u.id = t.assignee_user_id
    LEFT JOIN engagement e ON t.entity_type = 'engagement' AND e.id = t.entity_id::uuid
    LEFT JOIN person p ON p.id = e.person_id
    LEFT JOIN job j ON j.id = e.job_id
    WHERE t.completed_at IS NULL AND t.due_at::date = current_date
    ORDER BY t.due_at ASC NULLS LAST
  `);
  return rows.map(mapRow);
}

export async function listOverdueTasks(): Promise<TaskRow[]> {
  const rows = await db.execute<RawTaskRow>(sql`
    SELECT t.id, t.type, t.category::text, t.priority::text, t.sla_zone::text AS sla_zone, t.notes,
           t.due_at, t.completed_at, u.name AS assignee_name, t.entity_type, t.entity_id,
           CASE WHEN t.entity_type = 'engagement' THEN p.primary_name || ' — ' || j.title ELSE NULL END AS entity_label
    FROM task t
    LEFT JOIN app_user u ON u.id = t.assignee_user_id
    LEFT JOIN engagement e ON t.entity_type = 'engagement' AND e.id = t.entity_id::uuid
    LEFT JOIN person p ON p.id = e.person_id
    LEFT JOIN job j ON j.id = e.job_id
    WHERE t.completed_at IS NULL AND t.due_at < now()
    ORDER BY t.due_at ASC
  `);
  return rows.map(mapRow);
}

export async function listTasksByCategory(category: string): Promise<TaskRow[]> {
  const rows = await db.execute<RawTaskRow>(sql`
    SELECT t.id, t.type, t.category::text, t.priority::text, t.sla_zone::text AS sla_zone, t.notes,
           t.due_at, t.completed_at, u.name AS assignee_name, t.entity_type, t.entity_id,
           CASE WHEN t.entity_type = 'engagement' THEN p.primary_name || ' — ' || j.title ELSE NULL END AS entity_label
    FROM task t
    LEFT JOIN app_user u ON u.id = t.assignee_user_id
    LEFT JOIN engagement e ON t.entity_type = 'engagement' AND e.id = t.entity_id::uuid
    LEFT JOIN person p ON p.id = e.person_id
    LEFT JOIN job j ON j.id = e.job_id
    WHERE t.completed_at IS NULL AND t.category = ${category}
    ORDER BY t.due_at ASC NULLS LAST
  `);
  return rows.map(mapRow);
}

export async function completeTask(taskId: string, actor: Actor): Promise<void> {
  await withActor(actor, async (tx) => {
    const [before] = await tx.select().from(task).where(eq(task.id, taskId)).limit(1);
    await tx.update(task).set({ completedAt: new Date(), completedBy: actor.userId }).where(eq(task.id, taskId));
    await writeAuditLog(tx, {
      actorUserId: actor.userId,
      action: "complete_task",
      entityType: "task",
      entityId: taskId,
      before,
      after: { completedAt: new Date() },
    });
  });
}

export async function createTask(
  input: {
    type: string;
    category: "client_follow_up" | "candidate_follow_up" | "interview" | "offer" | "finance" | "data_quality" | "general";
    priority?: "low" | "medium" | "high" | "urgent";
    dueAt?: Date;
    assigneeUserId?: string;
    entityType?: string;
    entityId?: string;
    engagementId?: string;
    notes?: string;
  },
  actor: Actor,
): Promise<string> {
  return withActor(actor, async (tx) => {
    const [created] = await tx
      .insert(task)
      .values({
        type: input.type,
        category: input.category,
        priority: input.priority ?? "medium",
        dueAt: input.dueAt,
        assigneeUserId: input.assigneeUserId,
        entityType: input.entityType,
        entityId: input.entityId,
        engagementId: input.engagementId,
        notes: input.notes,
        taskKind: "manual",
        autoGenerated: false,
      })
      .returning({ id: task.id });
    return created!.id;
  });
}
