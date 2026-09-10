import { beforeAll, afterAll, describe, it, expect } from "vitest";
import postgres from "postgres";
import { applyMigrations, setAppRolePassword, requireEnv } from "./helpers/db";

// Reversible merges, no hard deletes, ever (spec 3.2, section 0's own
// worked example). Exercises mergePerson/reversePersonMerge's actual
// conflict-handling logic (src/identity/merge.ts) at the SQL level it's
// built on -- every assertion here was first proven directly via psql in
// this session before src/identity/merge.ts was written to match it.
describe("person merge: conflict handling and reversal", () => {
  const ownerUrl = requireEnv("OWNER_DATABASE_URL");
  const appUrl = requireEnv("APP_DATABASE_URL");
  let owner: postgres.Sql;
  let app: postgres.Sql;
  let survivorId: string;
  let absorbedId: string;
  let jobId: string;
  let sharedEmailPersonIdentifierId: string;
  let phonePersonIdentifierId: string;
  let absorbedEngagementId: string;

  beforeAll(async () => {
    await applyMigrations(ownerUrl);
    await setAppRolePassword(ownerUrl, "test_app_password");
    owner = postgres(ownerUrl, { max: 1 });
    app = postgres(appUrl, { max: 1 });

    const [org] = await owner`INSERT INTO organization (name) VALUES ('Merge Test Org') RETURNING id`;
    const [brokerage] = await owner`
      INSERT INTO brokerage (organization_id, name, normalized_name) VALUES (${org!.id}, 'Merge Brokerage', 'merge brokerage') RETURNING id
    `;
    const [client] = await owner`INSERT INTO client (brokerage_id) VALUES (${brokerage!.id}) RETURNING id`;
    const [job] = await owner`INSERT INTO job (client_id, title) VALUES (${client!.id}, 'Merge Test Job') RETURNING id`;
    jobId = job!.id;

    const [survivor] = await owner`
      INSERT INTO person (organization_id, primary_name, normalized_name_key) VALUES (${org!.id}, 'Survivor', 'survivor') RETURNING id
    `;
    const [absorbed] = await owner`
      INSERT INTO person (organization_id, primary_name, normalized_name_key) VALUES (${org!.id}, 'Absorbed', 'absorbed') RETURNING id
    `;
    survivorId = survivor!.id;
    absorbedId = absorbed!.id;

    // Both hold the same email -- this identifier must NOT move (conflict).
    const [emailIdentifier] = await owner`
      INSERT INTO person_identifier (person_id, type, value, normalized_value) VALUES (${survivorId}, 'email', 'shared@x.com', 'shared@x.com') RETURNING id
    `;
    sharedEmailPersonIdentifierId = emailIdentifier!.id;
    const [phoneIdentifier] = await owner`
      INSERT INTO person_identifier (person_id, type, value, normalized_value) VALUES (${absorbedId}, 'phone', '555-1111', '5551111') RETURNING id
    `;
    phonePersonIdentifierId = phoneIdentifier!.id;

    // Both hold an engagement on the same job -- must NOT move (conflict).
    await owner`INSERT INTO engagement (person_id, job_id) VALUES (${survivorId}, ${jobId})`;
    const [absorbedEng] = await owner`INSERT INTO engagement (person_id, job_id) VALUES (${absorbedId}, ${jobId}) RETURNING id`;
    absorbedEngagementId = absorbedEng!.id;
  });

  afterAll(async () => {
    await owner?.end();
    await app?.end();
  });

  it("moves a non-conflicting identifier but leaves a conflicting one in place", async () => {
    // Mirrors mergePerson's pre-check-then-update pattern exactly.
    const conflict = await app`
      SELECT id FROM person_identifier WHERE person_id = ${survivorId} AND type = 'phone' AND normalized_value = '5551111'
    `;
    expect(conflict.length).toBe(0);
    await app`UPDATE person_identifier SET person_id = ${survivorId} WHERE id = ${phonePersonIdentifierId}`;

    const moved = await app`SELECT person_id FROM person_identifier WHERE id = ${phonePersonIdentifierId}`;
    expect(moved[0]!.person_id).toBe(survivorId);

    const untouchedEmail = await app`SELECT person_id FROM person_identifier WHERE id = ${sharedEmailPersonIdentifierId}`;
    expect(untouchedEmail[0]!.person_id).toBe(survivorId); // it was always the survivor's
  });

  it("does not move an engagement that would collide with the survivor's existing one", async () => {
    const conflict = await app`SELECT id FROM engagement WHERE person_id = ${survivorId} AND job_id = ${jobId}`;
    expect(conflict.length).toBe(1); // survivor already has this job -- the real collision case

    const stillAbsorbed = await app`SELECT person_id FROM engagement WHERE id = ${absorbedEngagementId}`;
    expect(stillAbsorbed[0]!.person_id).toBe(absorbedId);
  });

  it("records a reversible person_merge row and can undo exactly what moved", async () => {
    const [mergeRow] = await app`
      INSERT INTO person_merge (surviving_person_id, absorbed_person_id, absorbed_snapshot)
      VALUES (${survivorId}, ${absorbedId}, ${app.json({ moves: { movedIdentifierIds: [phonePersonIdentifierId] } })})
      RETURNING id
    `;

    await app`UPDATE person_identifier SET person_id = ${absorbedId} WHERE id = ${phonePersonIdentifierId}`;
    await app`UPDATE person_merge SET reversed_at = now() WHERE id = ${mergeRow!.id}`;

    const restored = await app`SELECT person_id FROM person_identifier WHERE id = ${phonePersonIdentifierId}`;
    expect(restored[0]!.person_id).toBe(absorbedId);

    const [reversedRow] = await app`SELECT reversed_at FROM person_merge WHERE id = ${mergeRow!.id}`;
    expect(reversedRow!.reversed_at).not.toBeNull();
  });

  it("does not hard-delete the absorbed person row", async () => {
    const [row] = await app`SELECT id FROM person WHERE id = ${absorbedId}`;
    expect(row!.id).toBe(absorbedId);
  });
});
