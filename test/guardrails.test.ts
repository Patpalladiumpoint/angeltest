import { beforeAll, afterAll, describe, it, expect } from "vitest";
import postgres from "postgres";
import { applyMigrations, setAppRolePassword, requireEnv } from "./helpers/db";

// The non-deferrable guarantees from section 0/6/8, proven against a real
// Postgres -- not mocked. Every assertion here was first hand-verified via
// psql directly against this same migration set in this session (see
// README, "A note on this session's constraints" -- no npm registry access
// means this file itself has not been run through vitest here).
describe("append-only audit_log and event", () => {
  const ownerUrl = requireEnv("OWNER_DATABASE_URL");
  const appUrl = requireEnv("APP_DATABASE_URL");
  let owner: postgres.Sql;
  let app: postgres.Sql;

  beforeAll(async () => {
    await applyMigrations(ownerUrl);
    await setAppRolePassword(ownerUrl, "test_app_password");
    owner = postgres(ownerUrl, { max: 1 });
    app = postgres(appUrl, { max: 1 });
  });

  afterAll(async () => {
    await owner?.end();
    await app?.end();
  });

  it("rejects UPDATE/DELETE on audit_log at the role level and via trigger", async () => {
    const [row] = await app`INSERT INTO audit_log (action, entity_type, entity_id) VALUES ('test','x','1') RETURNING id`;

    await expect(app`UPDATE audit_log SET action = 'x' WHERE id = ${row!.id}`).rejects.toThrow(/permission denied/);
    await expect(owner`UPDATE audit_log SET action = 'x' WHERE id = ${row!.id}`).rejects.toThrow(/append-only/);
    await expect(owner`DELETE FROM audit_log WHERE id = ${row!.id}`).rejects.toThrow(/append-only/);
  });

  it("rejects UPDATE/DELETE on event the same way", async () => {
    const [row] = await app`
      INSERT INTO event (type, source, entity_type, entity_id, payload, occurred_at)
      VALUES ('test.event', 'system', 'x', '1', '{}'::jsonb, now()) RETURNING id
    `;

    await expect(app`UPDATE event SET type = 'x' WHERE id = ${row!.id}`).rejects.toThrow(/permission denied/);
    await expect(owner`DELETE FROM event WHERE id = ${row!.id}`).rejects.toThrow(/append-only/);
  });

  it("enforces event.external_id idempotency via the partial unique index", async () => {
    await app`
      INSERT INTO event (type, source, entity_type, entity_id, payload, occurred_at, external_id)
      VALUES ('test.event', 'system', 'x', '1', '{}'::jsonb, now(), 'ext-1')
    `;
    await expect(
      app`
        INSERT INTO event (type, source, entity_type, entity_id, payload, occurred_at, external_id)
        VALUES ('test.event', 'system', 'x', '1', '{}'::jsonb, now(), 'ext-1')
      `,
    ).rejects.toThrow(/duplicate key/);

    // Multiple NULL external_ids must NOT collide (partial index).
    await app`INSERT INTO event (type, source, entity_type, entity_id, payload, occurred_at) VALUES ('t','system','x','1','{}'::jsonb, now())`;
    await app`INSERT INTO event (type, source, entity_type, entity_id, payload, occurred_at) VALUES ('t','system','x','1','{}'::jsonb, now())`;
  });
});

describe("do-not-contact hard stop (section 6)", () => {
  const ownerUrl = requireEnv("OWNER_DATABASE_URL");
  let owner: postgres.Sql;
  let orgId: string;
  let jobId: string;

  beforeAll(async () => {
    owner = postgres(ownerUrl, { max: 1 });
    const [org] = await owner`INSERT INTO organization (name) VALUES ('DNC Test Org') RETURNING id`;
    orgId = org!.id;
    const [brokerage] = await owner`
      INSERT INTO brokerage (organization_id, name, normalized_name) VALUES (${orgId}, 'DNC Test Brokerage', 'dnc test brokerage') RETURNING id
    `;
    const [client] = await owner`INSERT INTO client (brokerage_id) VALUES (${brokerage!.id}) RETURNING id`;
    const [job] = await owner`INSERT INTO job (client_id, title) VALUES (${client!.id}, 'DNC Test Job') RETURNING id`;
    jobId = job!.id;
  });

  afterAll(async () => {
    await owner?.end();
  });

  it("blocks creating an engagement for a do_not_contact person", async () => {
    const [dncPerson] = await owner`
      INSERT INTO person (organization_id, primary_name, normalized_name_key, do_not_contact, dnc_reason)
      VALUES (${orgId}, 'DNC Person', 'dnc person', true, 'requested no contact') RETURNING id
    `;

    await expect(owner`INSERT INTO engagement (person_id, job_id) VALUES (${dncPerson!.id}, ${jobId})`).rejects.toThrow(
      /do-not-contact/,
    );
  });

  it("allows creating an engagement for a non-DNC person", async () => {
    const [person] = await owner`
      INSERT INTO person (organization_id, primary_name, normalized_name_key) VALUES (${orgId}, 'OK Person', 'ok person') RETURNING id
    `;
    const [eng] = await owner`INSERT INTO engagement (person_id, job_id) VALUES (${person!.id}, ${jobId}) RETURNING id`;
    expect(eng!.id).toBeTruthy();
  });
});

describe("section 8 column-level permissions (comp, fee_percent, fee_override)", () => {
  const ownerUrl = requireEnv("OWNER_DATABASE_URL");
  const appUrl = requireEnv("APP_DATABASE_URL");
  let owner: postgres.Sql;
  let app: postgres.Sql;
  let employmentId: string;
  let contractId: string;

  beforeAll(async () => {
    owner = postgres(ownerUrl, { max: 1 });
    app = postgres(appUrl, { max: 1 });

    const [org] = await owner`INSERT INTO organization (name) VALUES ('Perm Test Org') RETURNING id`;
    const [person] = await owner`
      INSERT INTO person (organization_id, primary_name, normalized_name_key) VALUES (${org!.id}, 'Perm Person', 'perm person') RETURNING id
    `;
    const [employment] = await owner`
      INSERT INTO person_employment (person_id, employer_name, comp) VALUES (${person!.id}, 'Acme', '{"base":150000}'::jsonb) RETURNING id
    `;
    employmentId = employment!.id;

    const [brokerage] = await owner`
      INSERT INTO brokerage (organization_id, name, normalized_name) VALUES (${org!.id}, 'Perm Brokerage', 'perm brokerage') RETURNING id
    `;
    const [client] = await owner`INSERT INTO client (brokerage_id) VALUES (${brokerage!.id}) RETURNING id`;
    const [contract] = await owner`INSERT INTO client_contract (client_id, fee_percent) VALUES (${client!.id}, 25.0) RETURNING id`;
    contractId = contract!.id;
  });

  afterAll(async () => {
    await owner?.end();
    await app?.end();
  });

  it("denies direct SELECT of person_employment.comp to the app role", async () => {
    await expect(app`SELECT comp FROM person_employment WHERE id = ${employmentId}`).rejects.toThrow(/permission denied/);
  });

  it("still allows the app role to read other person_employment columns directly", async () => {
    const [row] = await app`SELECT employer_name FROM person_employment WHERE id = ${employmentId}`;
    expect(row!.employer_name).toBe("Acme");
  });

  it("audits every non-exec read of comp via the SECURITY DEFINER function", async () => {
    const before = await app`SELECT count(*)::int AS n FROM audit_log WHERE action = 'read_compensation'`;
    await app.begin(async (tx) => {
      await tx`SELECT set_config('app.actor_role', 'recruiter', true)`;
      await tx`SELECT get_person_employment_comp(${employmentId}::uuid)`;
    });
    const after = await app`SELECT count(*)::int AS n FROM audit_log WHERE action = 'read_compensation'`;
    expect(after[0]!.n).toBe(before[0]!.n + 1);
  });

  it("hides client_contract.fee_percent from a recruiter actor but not ops/exec", async () => {
    const recruiterResult = await app.begin(async (tx) => {
      await tx`SELECT set_config('app.actor_role', 'recruiter', true)`;
      return tx`SELECT get_client_contract_fee_percent(${contractId}::uuid) AS fee`;
    });
    expect(recruiterResult[0]!.fee).toBeNull();

    const execResult = await app.begin(async (tx) => {
      await tx`SELECT set_config('app.actor_role', 'exec', true)`;
      return tx`SELECT get_client_contract_fee_percent(${contractId}::uuid) AS fee`;
    });
    expect(Number(execResult[0]!.fee)).toBe(25);
  });
});
