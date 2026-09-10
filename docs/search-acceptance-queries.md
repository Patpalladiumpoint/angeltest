# Search acceptance test (spec section 4, DECISION 1)

Written in Phase 1 per the spec's own instruction ("write these 20 queries
in Phase 1 while the legacy system is still live for comparison"), before
Phase 3 builds search. **These are this session's best plausible
construction of what a recruiter runs daily, not queries an actual
recruiter dictated** -- this environment has no access to the firm's real
legacy system or its users. Before Phase 3's acceptance test is run for
real, a recruiter must review this list and replace any query that doesn't
match what they actually search for. The test itself is not waivable:
"a recruiter, not the agent, judges each result set as equal-or-better. 18
of 20 must pass before any live work enters the system."

For each query at Phase 3: run it against Palladium OS and the legacy
system, and record which one wins (or tie).

| # | Query | Type | Why it matters |
|---|---|---|---|
| 1 | `jane doe` | name | Baseline exact full-name lookup. |
| 2 | `doe` | name, partial | Surname-only partial match, common when a recruiter half-remembers a name. |
| 3 | `j. doe` | name, initial | First-initial-plus-surname pattern from old notes/emails. |
| 4 | `alliant` | employer | Free-text employer lookup, no candidate name known yet. |
| 5 | `marsh mclennan` | employer, multi-word | Employer name with a space/ampersand variant. |
| 6 | `vp production` | title | Free-text title search across current employment records. |
| 7 | `svp employee benefits` | title, multi-word | Longer title phrase, exercises ranking (name/title weighted per section 4). |
| 8 | `jane.doe@` | email fragment | Partial email lookup -- recruiter has an email screenshot, not a full address. |
| 9 | `415-555` | phone fragment | Partial phone number lookup. |
| 10 | `producer property casualty woodruff` | free text, resume content | Combines a title phrase with an employer, simulating a half-remembered resume detail. |
| 11 | `stage:submitted owner:me` | structured filter | "My active submittals" -- the single most common recruiter view. |
| 12 | `stage:client_process last_activity>7d` | structured filter, staleness | Finds engagements at risk of going stale mid-process. |
| 13 | `brokerage_rank<=25` | structured filter, eligibility | Confirms the Top 100 rank-band filter (section 4.2 bullet). |
| 14 | `stage:sourced owner:unassigned` | structured filter, ownerless | Same shape as the data quality report's "no owner" check, but as an ad hoc search. |
| 15 | `do_not_contact:true` | structured filter, compliance | Recruiter double-checking a DNC flag before an outreach push. |
| 16 | `gallagher stage:offer` | employer + stage combined | Free text combined with a structured filter (section 4's own requirement: "combining a text query with a facet filter"). |
| 17 | `kathy miller` | name, nickname variant | Exercises whether search surfaces the same person under a name variant even before the merge queue resolves the underlying duplicate (see `person_merge_candidate` P-1004/P-1005 in fixtures). |
| 18 | `risk strategies principal` | employer + title | Two-term free text, no exact phrase match expected. |
| 19 | `hub international` | employer, exact | Common short employer name -- must not false-positive-match unrelated "international" mentions elsewhere. |
| 20 | `wendy` | first name only | Single common first name -- worst case for ranking noise; results must still surface the right person near the top. |

## Explicitly out of scope for this test (DECISION 1)

Saved searches, semantic/vector similarity mode, boolean query syntax
(`AND`/`OR`/`NOT`), and search-within-results are cut from MVP search and
have no queries above testing them.
