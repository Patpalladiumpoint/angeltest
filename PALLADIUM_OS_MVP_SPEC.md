# Palladium OS: MVP Build Specification

**Audience:** Claude Code (autonomous implementation agent)
**Owner:** Palladium Point
**Scope:** MVP. 11 weeks. Palladium OS is the ATS and the sole record of truth for everything inside MVP scope.
**Status:** v3.0 (MVP). All decisions locked. Nothing here is blocked on an unanswered question.

---

## 0. Read this first (agent instructions)

This is an **MVP build**, not a prototype and not a full replacement. It goes into production and a 5 person search firm runs live revenue-generating work on it. It is the sole record of truth for the work inside its scope. There is no vendor system behind it.

That combination means MVP discipline applies to **features**, not to **data integrity**.

### DECISION 0: The irreversibility test governs all scope

Every scope decision is tested with one question:

> **If we skip this now and want it in six months, can we add it then with full history intact?**

- **Yes** to cut. Aggressively. Manual workarounds are acceptable and expected.
- **No** to build now, even if it feels premature for an MVP.

Examples of correct application:

| Item | Backfillable? | MVP decision |
|---|---|---|
| QuickBooks invoice push | Yes, manual entry meanwhile | **Cut** |
| Gmail API sync and threading | Yes, forwarding address meanwhile | **Cut, replaced with cheap version** |
| Bulk operations, saved searches | Yes | **Cut** |
| Exec dashboard | Yes, queries meanwhile | **Cut** |
| Append-only `event` log | **No.** Missing events cannot be invented | **Build** |
| Signed-entry commission ledger | **No.** A computed field destroys the history | **Build** |
| Immutable commission plan versions | **No.** Cannot reconstruct what a plan said | **Build** |
| `audit_log` | **No.** Cannot reconstruct who did what | **Build** |
| Reversible merges, no hard deletes | **No.** Absorbed data is gone | **Build** |
| Tested backup and restore | **No.** This is the only copy of the data | **Build** |

If you encounter a scope decision not covered here, apply this test and report your reasoning rather than guessing.

### Hard rules

1. **Never mock an integration.** If an external API behaves differently than documented here, stop and report.
2. **Manual workarounds are a valid MVP answer.** Prefer a documented manual step over a fragile automation. Document every manual step in `/docs/manual-steps.md`.
3. **Migrations only.** No manual schema changes. No destructive migration without a reversible plan.
4. **Ask before adding a dependency** outside the approved stack in section 2.
5. **Config lives in code, not in an admin UI.** See section 2.1.
6. **Feature flag everything user facing.** Per user, stored in the database, togglable without deploy.
7. **Write the runbook as you build.** A section of `/docs/runbook.md` is part of the definition of done for every phase.
8. **Do-not-contact and compensation access controls are MVP scope**, not deferred. See section 6.
9. When a phase finishes, produce a written list of what a human must verify manually. Never call a phase done on passing tests alone.

---

## 1. What the MVP is

Palladium OS MVP owns, in one data model:

- **The candidate, client, and job record** for active work. This is the ATS.
- **Process state.** Where each engagement is, what happened last, what is owed next, whether it is late.
- **The commission and fee ledger.** Traceable, append-only, reconciled to history.
- **Exception surfacing.** Stalls and gaps presented as decisions.

### Explicitly NOT in the MVP

- Full historical candidate database. See DECISION 4.
- QuickBooks integration. Manual invoice entry.
- Gmail API sync and threading. Forwarding address instead. See DECISION 5.
- Knowledge base, document ingestion, RAG, SOP retrieval.
- Submittal generation, interview prep briefs, structured feedback analysis.
- Executive dashboard and reporting layer.
- Bulk operations, saved searches, job board posting.
- Outreach sequencing integration.
- Candidate or client portals. Mobile app. Multi tenant.
- Any configuration UI for rules.

Each deferred item has a stated re-entry path in section 10.

---

## 2. Approved stack

| Layer | Choice |
|---|---|
| Language | TypeScript, strict mode |
| App | Next.js (App Router) |
| DB | Postgres via Supabase (`pgvector`, `pg_trgm` enabled) |
| ORM | Drizzle |
| Search | Postgres full text plus `pg_trgm`. See section 4. |
| File storage | Supabase Storage, signed URLs only |
| Background jobs | Inngest |
| Resume parsing | Vendor API (Textkernel, Affinda, or RChilli) behind an adapter. **Never build parsing.** |
| Auth | Supabase Auth, Google SSO only |
| Hosting | Vercel |
| AI | Anthropic API, structured output via tool schemas |
| Observability | Sentry plus in-app `audit_log` |

Forbidden without approval: Kafka, microservices, Kubernetes, GraphQL, Redis, Elasticsearch, custom auth, any separate backend service.

### 2.1 Configuration as code

All rule sets are typed TypeScript files under version control with tests. No configuration UI in the MVP for:

- Engagement stages, transitions, SLAs, generated tasks (`/src/workflow/engagement.ts`)
- Commission plans (`/src/money/plans/`)
- Exception rules (`/src/exceptions/rules.ts`)
- Fee models (`/src/money/fee-models.ts`)

Rationale: the maintenance model is a non-engineer owner plus an AI coding agent. An agent can confidently edit a typed config file, run tests, and open a PR. It cannot click through an admin panel. Config as code is more maintainable here, not less. Admin UI is for data, never for rules.

---

## 3. Data model

Principle: **events are immutable, state is derived, money is double entry.**

### 3.1 Core tables

```
organization            (the firm, single row, config)
user                    (recruiter, ops, exec; role, active_commission_plan_id)

person                  (canonical human record)
                        (primary_name, normalized_name_key, dedup_fingerprint,
                         do_not_contact bool, dnc_reason, dnc_set_at,
                         created_from, retention_reviewed_at)
person_identifier       (person_id, type [email | phone | linkedin_url | legacy_id],
                         value, normalized_value, is_primary,
                         UNIQUE(type, normalized_value))
person_employment       (person_id, employer_name, brokerage_id nullable, title,
                         is_current, comp jsonb, book_of_business jsonb, source)
person_merge            (surviving_person_id, absorbed_snapshot jsonb,
                         merged_by, merged_at, reversed_at)

document_file           (entity ref, storage_path, filename, mime_type,
                         kind [resume | contract | submittal | transcript | other],
                         parsed_profile jsonb, parse_status, uploaded_by)

brokerage               (name, rank, rank_source, rank_as_of, is_client)
client                  (brokerage_id, tier, owner_user_id, status)
client_contract         (client_id, fee_model, fee_percent, fee_basis,
                         guarantee_days, payment_terms_days,
                         effective_from, effective_to)
job                     (client_id, contract_id, status, fee_override,
                         target_comp_range, owner_user_id)

engagement              (person_id + job_id UNIQUE, current_stage, stage_entered_at,
                         owner_user_id, sourcer_user_id, status,
                         round_number, rounds_expected,
                         next_action_due_at, expected_fee,
                         brokerage_rank_snapshot)
placement               (engagement_id, start_date, guaranteed_through,
                         accepted_comp jsonb, fee_amount,
                         fee_calc_snapshot jsonb, status)
```

**Why `person` and not `candidate`:** the same human is a candidate on one search, a client contact on another, and a referral source on a third. Separate rows per role is the most common ATS data model error and produces permanent duplicate pollution. One `person`, many roles. This is not deferrable, because it is the single most expensive thing to change later.

**`brokerage.rank` is operationally load-bearing.** The firm only contacts candidates inside the top 100 brokerages. Store rank with `rank_as_of` and snapshot it onto the engagement at sourcing time so eligibility stays auditable when rankings shift.

### 3.2 Identity resolution (MVP scope, not deferrable)

1. **Deterministic match** on any normalized `person_identifier`. Email and LinkedIn URL are near-certain. Auto-merge.
2. **Strong fuzzy match**: `pg_trgm` name similarity plus matching current employer. Surface in a **merge review queue**. Never auto-merge.
3. **Weak signals never merge.**

Merges write a `person_merge` row containing the full pre-merge state and are reversible. **No hard deletes on merge, ever.** MVP UI for this is a simple two-column review list with merge and reject buttons. That is sufficient.

### 3.3 Process tables (not deferrable)

```
event                   (immutable append only. type, source, entity_type, entity_id,
                         payload jsonb, occurred_at, ingested_at,
                         external_id UNIQUE for idempotency)
task                    (engagement_id nullable, type, assignee_user_id, due_at,
                         completed_at, completed_by, auto_generated bool)
exception               (rule_id, entity ref, severity, revenue_at_risk,
                         opened_at, resolved_at, resolution, snoozed_until)
audit_log               (actor, action, entity_type, entity_id,
                         before jsonb, after jsonb, at)
activity_note           (entity ref, author_user_id, body, created_at)
```

The `event` table is the spine. Every inbound signal (forwarded email, calendar change, manual UI action, import) becomes an event row before anything else happens. Missing events cannot be invented later, which is why this is in the MVP despite looking like infrastructure.

### 3.4 Money tables (not deferrable)

```
fee                     (placement_id, gross_amount, calc_snapshot jsonb,
                         recognized_at, status)
invoice                 (fee_id, issued_at, due_at, amount, status,
                         external_ref nullable)    -- manually entered in MVP
payment                 (invoice_id, received_at, amount,
                         entered_by)               -- manually entered in MVP
commission_plan_version (user_id, version, effective_from, rules jsonb,
                         accrual_trigger enum, superseded_by)
commission_entry        (user_id, placement_id, plan_version_id,
                         type enum [accrual | reversal | adjustment | payout],
                         amount SIGNED, basis jsonb, created_at, created_by,
                         reverses_entry_id nullable)
```

Rules, none waivable for MVP:

- **Commission is never a computed column.** It is signed ledger entries. Balance owed equals the sum of entries.
- **Corrections are reversing entries.** Never updates, never deletes. A fall off creates a reversal referencing the original accrual.
- **Plan versions are immutable.** Changing a plan creates a new version. Existing accruals keep their original `plan_version_id` forever.
- **Every accrual stores a `basis` snapshot**: the exact inputs used at calculation time.

`invoice` and `payment` are populated manually in the MVP. The schema is built as though integrated, so Phase 4 wires QuickBooks in without a migration.

---

## 4. ATS core: MVP scope

### DECISION 1: Search is the adoption gate, and it is not cut

Recruiters use search dozens of times a day. If it is worse than what they had, nothing else in the system matters. Search is the one place where MVP quality standards do not apply.

**MVP search requirements:**

- One search box handling name, employer, title, email fragment, phone, and free text over parsed resume content.
- Composable structured filters: stage, owner, brokerage rank band, last-activity age, do-not-contact.
- **Sub-400ms p95** against production-shaped data.
- Results show current employer, title, stage, owner, last activity, without opening the record.

**Cut from search in MVP:** saved searches, semantic or vector similarity mode, boolean query syntax, search within results.

**Acceptance test, mandatory and not waivable:** write 20 real searches the team performs today. Run each against Palladium OS and against the legacy system. **A recruiter, not the agent, judges each result set as equal-or-better. 18 of 20 must pass before any live work enters the system.** Write these 20 queries in Phase 1 while the legacy system is still live for comparison.

### 4.2 Other MVP ATS requirements

- **Activity timeline** per person and per engagement: every event, task, stage change, note, and ingested message in one reverse-chronological view. This is what replaces "read the email to figure out what happened." Not cuttable.
- **Resume handling**: upload, parse via vendor adapter, store in Supabase Storage, signed URL access, version rather than overwrite. Parse failures degrade to manual entry, never to a blocked workflow.
- **Notes** with @mention that generates a task.
- **Merge review queue** per section 3.2.
- **Responsive web, readable and task-completable on a phone.** No native app.
- **CSV export of every entity.** The firm must not be locked into its own system either. Cheap now, and it is the escape hatch if the MVP fails.

**Cut:** bulk operations, tagging taxonomy, custom fields, duplicate-prevention-at-entry beyond the identifier constraint, advanced permissions UI.

---

## 5. State machine: MVP scope

### DECISION 2: Nine stages, interview rounds as events

```
sourced        identified, confirmed in-scope, not yet contacted
outreach       contacted, awaiting response
engaged        responded, in active dialogue
qualified      prescreened AND structured qualification captured
submitted      submittal sent to client
client_process client interviewing, one or more rounds
offer          offer extended, through acceptance
placed         accepted, through start date
secured        guarantee cleared and fee collected
```

Terminal branches from any stage: `candidate_declined`, `client_rejected`, `withdrawn`, `on_hold`, `fell_off`.

**Interview rounds are events inside `client_process`, not stages.** The engagement carries `round_number` and `rounds_expected`, with scheduling, occurrence confirmation, and feedback tracked per round.

Rationale: more stages means more places to stall and a config nobody maintains. Rounds-as-stages makes it impossible to express "round 2 scheduled while round 1 feedback is still missing," which is one of the exact failures in the current process.

### 5.2 Declarative definition

```ts
{
  stage: 'submitted',
  entryEffects: [
    { task: 'confirm_client_receipt', assignee: 'owner', dueIn: '2d' }
  ],
  exitConditions: ['client_response_recorded'],
  sla: { warnAfter: '3d', escalateAfter: '5d' },
  allowedNext: ['client_process', 'client_rejected', 'withdrawn'],
  onSlaBreach: {
    exception: 'submittal_no_response',
    notify: ['owner', 'exec_digest'],
    revenueAtRisk: 'engagement.expected_fee'
  }
}
```

### 5.3 Behavior requirements

- A transition **cannot** be recorded without its exit condition met, unless overridden with an explicit reason written to `audit_log`. Overrides are permitted. Silent skips are not.
- Entering a stage **auto-generates** its downstream tasks with due dates. This is the feature that replaces "someone remembering the next step." It is the core value of the MVP.
- Every stage and every round has an SLA. A breach creates an `exception` with revenue at risk attached.
- The 14-step reference workflow from the brief must be expressible end to end, with each step either automated, generated as a task, or declared out of scope in a code comment.

### 5.4 Nightly consistency job (MVP scope, cheap)

Detect logically impossible states and emit one ranked digest: placement with no fee, engagement at `placed` with no start date, invoice with no placement, placement past guarantee with no `secured` transition, engagement with no owner, unresolved merge candidates older than 7 days, parse failures.

---

## 6. Data protection (MVP scope, not deferrable)

There is no vendor behind this system. These are build requirements.

- **Do-not-contact is a system guarantee, not a field.** A person with `do_not_contact = true` cannot be added to an engagement and cannot be the target of an AI-drafted message. Enforced at the service layer and by database constraint, not in the UI.
- **Compensation data access is restricted and audited on read.** See section 8.
- **Nightly automated backup with a documented, tested restore.** Untested restores do not count. This is the only copy of the firm's data.
- **Signed URLs with short expiry** for all document access. No public buckets, ever.
- **Deletion path** documented and tested: remove a person and their documents while preserving anonymized fee history for accounting integrity.
- **Deferred to post-MVP:** automated retention enforcement job. MVP records `retention_reviewed_at` so the job can be added later without losing the ability to identify stale records.

---

## 7. Build phases

**Total: 11 weeks.** Each phase ships to production before the next begins.

### DECISION 3: Money spine before ATS core

Intuition says build the ATS first since it is the daily surface. But the ATS core is a 6 week block with nothing shippable in the middle. Leading with it means no production value for a month and a half while confidence erodes. The money spine ships in week 5, on the same data model, retires the commission spreadsheet, and touches nobody's daily workflow. It also proves the ledger and audit patterns everything else inherits.

### Phase 1: Foundation and narrow import (2 weeks)

- Auth, base schema, `event`, `audit_log`, identity resolution, backup and tested restore.
- **Narrow import** per DECISION 4.
- Merge review queue, worked down to zero strong-match candidates.
- **Data quality report**: unmappable stages, duplicate persons, engagements with no owner, placements with no invoice, missing start dates, and **currently stalled engagements ranked by days idle and expected fee**. This is immediate value in week 2 at zero operational risk.
- **Write the 20-query search acceptance test** now, while the legacy system is live for comparison.

### DECISION 4: Import active pipeline only, not the full history

Import scope:
- **All active engagements** and their persons, jobs, clients, contracts.
- **Placements from the last 24 months** with their fees, invoices, payments, and spreadsheet-calculated commissions. Needed for the shadow harness.
- **Resumes for imported persons only.**

**Do not import the full historical candidate database.** Leave it in the legacy system as a read-only archive.

Rationale: importing 150k historical records is what makes dedup hard, makes search hard, and makes data quality unknowable. This single scope cut removes most of the technical risk in the build. Historical candidates are a lookup need, not a workflow need, and bulk import remains available post-MVP once the model is proven.

### Phase 2: Money spine (3 weeks)

- Placement, fee, invoice, payment, commission ledger.
- Commission engine as a pure, versioned, fully tested function reading declarative plan rules.
- **Shadow calculation harness** per DECISION 6.
- Manual invoice and payment entry UI. No QuickBooks integration.
- Fall off handling via reversing entries.
- Per-recruiter commission statement showing every entry and its basis.
- **Retire the commission spreadsheet.** Exit criterion.

Done when one full month of commissions is calculated by the system, reconciled to the spreadsheet to the cent, and the spreadsheet is archived.

### DECISION 5: Email via forwarding address, not Gmail API

MVP ingests communication through a **dedicated ingest address** that the team bcc's or forwards to. Inbound mail is parsed, matched to a `person` via `person_identifier`, and written as an `event` plus a timeline entry. Unmatched mail goes to a review queue, never to a guessed record.

Rationale: full Gmail OAuth sync with correct threading, shared visibility, and personal-mail exclusion is multiple weeks and the hardest thing in the build to get right. A forwarding address captures the same data for a fraction of the effort and requires no OAuth scope review. The data model is identical, so the real sync drops in post-MVP without a migration or data loss.

### DECISION 6: Derive commission rules from history, do not collect them up front

Do not wait for a written statement of commission rules. Written rules and the actual spreadsheet will disagree, and the spreadsheet is what people were actually paid on.

1. Ingest 24 months of historical placements and their spreadsheet commissions (Phase 1).
2. Encode a first-pass rule set in `/src/money/plans/`.
3. Run the **shadow harness**: calculate every historical placement through the engine, diff against the spreadsheet.
4. Every non-zero delta is an engine bug or an undocumented rule. Investigate, encode, repeat.
5. **Phase 2 exits at zero delta across all 24 months.**

The rule set is an *output*, written to `/docs/commission-rules.md`. This is the only method that captures the edge cases nobody remembers.

### DECISION 7: Replicate current commission policy exactly, bug for bug

The MVP reproduces existing policy precisely, including whatever the current accrual trigger, split logic, and clawback behavior are.

Never change compensation policy inside a systems migration. If numbers move while the system changes, nobody can tell whether the system is wrong or the policy changed, and trust in the ledger never establishes. Policy improvements, such as moving accrual from placement to cash collected, are a separate decision after the ledger is trusted. Versioned plans make that a config change later, not a rebuild.

### Phase 3: ATS core plus state machine (6 weeks)

**These ship together, not sequentially.** An ATS without the automation layer is a worse version of what the team already has, and that is the largest adoption risk. The reason to switch must be present on day one.

- Person, employment, identifier, document handling, merge queue UI.
- Search per section 4, including the 20-query acceptance test.
- Activity timeline, notes, task list, exception inbox.
- Resume parsing vendor bake-off on 50 real resumes, then integration.
- Email ingest address per DECISION 5.
- Google Calendar bidirectional sync for interviews (link by event ID, never by title).
- Engagement state machine, transitions, auto task generation, SLAs, rounds-as-events.
- Exception engine plus Slack digest delivery.
- **Two AI jobs only:** transcript to structured qualification (largest manual-entry saving), and the ranked exception triage digest. Both write drafts a human confirms. Everything else AI-related is deferred.

### DECISION 8: MVP cutover model, new searches only

Not big-bang. Not one recruiter running parallel.

**All new searches opened after cutover date go into Palladium OS, for the whole team. All in-flight engagements stay in the legacy system until they close.**

- **No dual entry, ever.** Nobody maintains two truths.
- No big-bang risk. If the MVP has problems, only new searches are affected and the blast radius is small.
- The legacy system drains naturally over roughly a quarter as in-flight work closes out.
- The legacy system stays live and writable during the drain-down, which restores the fallback that a full cutover would have removed.

**Phase 3 exit gates, mandatory:**

- Search acceptance test: 18 of 20 judged equal-or-better by a recruiter.
- Zero unresolved strong-match merge candidates.
- Every engagement in the system has an owner, a stage, and a next action.
- Two consecutive weeks with no engagement stalling undetected.
- Every team member has completed a full workflow end to end unassisted.
- Backup restore tested, not just documented.

---

## 8. Permissions (MVP scope)

| Role | Pipeline | Candidate comp data | Own commission | Others' commission | Client fee percent |
|---|---|---|---|---|---|
| Recruiter | All | Yes, read audited | Yes | No | **No** |
| Ops | All | Yes, read audited | View all | View all | Yes |
| Exec | All | Yes | All | All | Yes |

Enforced with Postgres row level security, not application logic alone.

Rationale: fee percentage visibility is the dangerous one, because that is what leaks into candidate and client conversations and damages negotiating position. Commission visibility across a 5 person team creates friction with no operational upside. Both are nearly free now and painful to retrofit, which is why they are in the MVP.

---

## 9. Scale assumptions

Build for: under 150 placements per year, under 600 active engagements, **under 20k person records** (narrow import), under 15 users.

- Single Postgres instance. No read replicas, no caching layer, no queue beyond Inngest.
- Plain SQL. Optimize only when a real query misses its stated latency target against production-shaped data.
- **Premature scaling work is a spec violation.** If you find yourself adding infrastructure for throughput, stop and report.

---

## 10. Deferred scope and re-entry paths

Each deferred item, and what makes it safe to defer.

| Deferred | Re-entry path | Why safe |
|---|---|---|
| QuickBooks integration | Wire adapter to existing `invoice` and `payment` tables | Schema already models it. No migration. |
| Gmail API sync | Replace ingest-address parser, same `event` and timeline model | Identical data model. Historical forwarded mail retained. |
| Full historical candidate import | Run the Phase 1 importer against the full export | Importer already written and proven on the narrow set. |
| Knowledge base and RAG | Add `document`, `document_chunk`, `document_link` tables | Purely additive. No changes to existing model. |
| Submittal and prep generation | Add AI jobs against existing engagement and qualification data | Data already captured by the transcript job. |
| Exec dashboard | Query the existing unified model | The whole point of one data model. Reporting is a read concern. |
| Bulk operations, saved searches | Additive UI over existing search | No model impact. |
| Automated retention enforcement | Add job reading `retention_reviewed_at` | Field already present. |
| Outreach tool integration | New adapter writing `event` rows | Event log already the ingestion point. |

Every deferred item is additive. **None requires reworking anything the MVP builds.** That is the test the MVP scope was designed to pass.

---

## 11. Non negotiable engineering requirements

- **Audit log on every mutation**, plus every read of compensation data.
- **Row level security** per section 8.
- **Commission engine at 100% branch coverage.** Every rule discovered by the shadow harness gets a named test citing the historical placement that revealed it.
- **Identity resolution at 100% branch coverage.** A bad merge is unrecoverable in practice even when technically reversible.
- **Nightly backup with a tested restore**, verified before any live work enters the system.
- **Seed and fixture data** so a full local environment stands up with one command.
- **`/docs/manual-steps.md`**: every manual workaround the MVP relies on, and which deferred item eliminates it.
- **`/docs/runbook.md`**: credential rotation, correcting a bad commission entry, reversing a merge, adding a stage, adding a contract type, restoring from backup, handling a deletion request, what every exception rule means.
- **`/docs/commission-rules.md`**: derived output of Phase 2.
- **No secrets in code.** Environment variables only, documented in `.env.example`.

---

## 12. MVP success criteria

Decide whether to keep investing based on these, measured 6 weeks after Phase 3 cutover.

1. **The commission spreadsheet is gone and has not come back.**
2. **No engagement on a new search stalled undetected** for more than its stage SLA.
3. **No recruiter has created a side tracker** to compensate for a gap in the system. If they have, find out why. That is the exact failure pattern this project exists to end.
4. **Recruiters prefer it to the legacy system** for new searches, unprompted.
5. **Time from client interview confirmation to all downstream steps complete** is measurably shorter than the current 14-step manual chain.

If 1 through 3 hold, continue to the deferred roadmap. If 3 fails, stop and diagnose before building anything further.

---

## 13. Kill criteria

- **Search acceptance test cannot reach 18 of 20 after two remediation passes.** Do not put live work in the system. No other feature compensates for bad search.
- **Phase 2 shadow harness cannot reach zero delta in three passes.** The commission rules are genuinely undefined or were applied inconsistently. That is a business problem to fix before writing more code.
- **Dedup produces more than 2% false merges** on a sampled audit. Stop and redesign identity resolution.
- **Phase 3 exceeds 10 weeks.** Cut the state machine to manual stage transitions plus SLA exceptions only, ship the ATS core, and add automation as v1.1 rather than continuing to build without production use.
- **Total elapsed exceeds 16 weeks without cutover.** Stop. Keep the money spine as standalone value, keep the existing ATS, and reassess the ATS replacement as a separate decision.
