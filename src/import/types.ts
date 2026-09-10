// Narrow import row shape (DECISION 4): one row = one active engagement,
// with the person/brokerage/client/job/contract facts needed to place it
// and, when the engagement resulted in a placement, the placement/fee/
// invoice/payment/legacy-commission facts (last 24 months only, per
// DECISION 4) that Phase 2's shadow harness will reconcile against.
//
// This column set is this repo's own definition, not a format any real
// legacy system (Crelate or otherwise) actually exports -- no legacy
// system access exists in this environment. Hard rule 1 ("never mock an
// integration") is about not faking how an external system *behaves*; this
// is the opposite of that -- an honestly-documented, testable import
// contract with fixture data standing in for a real export until one is
// provided. See src/import/fixtures/README.md.
export type NarrowImportRow = {
  external_id: string; // legacy system's own row/record id -- becomes person_identifier(type=legacy_id) and this row's dedup key

  person_name: string;
  person_email?: string;
  person_phone?: string;
  person_linkedin_url?: string;
  person_do_not_contact?: "true" | "false" | "";
  person_dnc_reason?: string;

  employer_name?: string;
  employer_title?: string;
  employer_is_current?: "true" | "false" | "";

  brokerage_name: string; // the CLIENT's brokerage (who the job is for), not necessarily the candidate's employer
  brokerage_rank?: string;
  brokerage_rank_source?: string;

  client_tier?: "strategic" | "standard" | "prospect" | "";
  contract_fee_model?: "contingency" | "retained" | "hourly" | "";
  contract_fee_percent?: string;
  contract_guarantee_days?: string;

  job_title: string;
  job_status?: "open" | "on_hold" | "filled" | "cancelled" | "";

  engagement_stage: string; // validated against engagementStageEnum at import time
  engagement_owner_email?: string;
  engagement_expected_fee?: string;

  // Populated only for rows representing a placement in the last 24
  // months (DECISION 4). Blank for an active, unplaced engagement.
  placement_start_date?: string;
  placement_fee_amount?: string;
  placement_invoice_amount?: string;
  placement_invoice_issued_at?: string;
  placement_payment_amount?: string;
  placement_payment_received_at?: string;
  placement_legacy_commission_amount?: string;
  placement_recruiter_email?: string;
};

export type ImportOutcome = {
  externalId: string;
  status: "created" | "updated" | "skipped_duplicate" | "error";
  personId?: string;
  engagementId?: string;
  mergeCandidatesEnqueued?: number;
  error?: string;
};
