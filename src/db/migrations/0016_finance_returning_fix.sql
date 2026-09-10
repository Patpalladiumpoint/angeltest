-- Real bug, caught live against Postgres while verifying the finance
-- write path: `INSERT ... RETURNING id` requires SELECT privilege on the
-- returned column even though INSERT itself doesn't -- migration 0013's
-- blanket `REVOKE SELECT ON invoice, payment, commission FROM
-- palladium_app` broke every createInvoice()/createCommission() call
-- that uses drizzle's .returning({ id: ... }), which is all of them.
--
-- Fix: grant SELECT on just the `id` column. A UUID primary key carries
-- no financial information (not sequential, not derivable to anything
-- sensitive) -- amount/commission_amount/commission_percent/status and
-- every other column stay exactly as locked down as before, readable
-- only through invoices_for_actor()/payments_for_actor()/
-- commissions_for_actor(). Verified: app role can now INSERT ... RETURNING
-- id on all three tables, and still gets permission denied on SELECT
-- amount/commission_amount directly.
GRANT SELECT (id) ON invoice TO palladium_app;
GRANT SELECT (id) ON payment TO palladium_app;
GRANT SELECT (id) ON commission TO palladium_app;
