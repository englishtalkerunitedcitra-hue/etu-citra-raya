# Monthly Lead IDs

New application leads receive an immutable display code such as `Nov26-037` when
first saved successfully. The month comes from server creation time in Asia/Jakarta,
not the device clock or editable Tanggal Masuk. Explicit English month abbreviations
avoid locale-dependent spelling. Numbering starts at 001 for each month/year, continues
past 100/999 without truncation, and never reuses a code after deletion.

`id` remains the internal UUID used by API relationships, activity history, Top 3,
optimistic concurrency and Google row assignments. `lead_code` is the display code.
Older leads are not renumbered: their existing UUID/code and historical Sheet IDs stay
unchanged. App list, editor, save confirmation and search support the new code. Master
and Activity exports show the display code, with UUID fallback for old records; no
Sheet header/layout change is needed.

## Allocation and collision protection

The allocator atomically increments a protected row for each month and inserts a
permanent reservation in the same save transaction. Concurrent saves serialize on that
monthly counter. Failed saves roll back allocation; duplicate request IDs reuse the
existing save result. Updates cannot change the assigned code, including trusted direct
updates. Staff/anonymous callers cannot read counters or invoke allocation/reservation.

Before activation, read existing IDs from the original Master Prospek and any stored
legacy IDs, then call `reserve_legacy_lead_codes` inside the same transaction as the
migration. The service-only reservation RPC advances counters to the maximum existing
suffix and retains reservations. It accepts case variants and Indonesian Mei/Okt/Des
aliases, treating them as the same month as May/Oct/Dec. It does not import people or
change any old ID. No business data or actual ID reservation list is committed here.

At the initial audit on 12 November 2026 the original November series reached 036;
activation must refresh that audit rather than hardcode the next number in frontend.

## Operational boundary

This automation is for saves through the staff application. Direct manual rows/formulas
in the original Sheet do not use this counter or flow back into Supabase. Use the app
for new leads to keep a single numbering authority. Before importing additional external
records or resuming independent manual numbering, reconcile and reserve their codes.
A concurrent independent Sheet formula cannot be made atomic with the database counter.

## Release and validation

Apply `202611120002_monthly_lead_codes.sql` and reserve the refreshed legacy list in one
transaction, preserving a private database snapshot first. Deploy the worker mapping,
then publish the reviewed staff bundle. No Google header migration or historical data
rewrite is required. Verify old records remain unchanged and queues are healthy.

Local tests exercise 20 concurrent distinct saves, eight concurrent retries of one save,
legacy reservations and aliases, failed-save rollback, immutable updates, outbox/audit
codes, unauthorized access, WIB year rollover and numbers beyond 999. Model/sync tests
cover display-code search, Master/Activity code export and old UUID fallback. Existing
real Auth/PostgREST and staff/admin/mobile/public-trial regression suites also run.

```sh
npm run build:staff
npm test
npm run test:sheets
ETU_LOCAL_BACKEND_STATUS=/tmp/etu-master-local/status.json python tests/monthly-lead-codes-integration.py
```

The monthly concurrency fixture expects a disposable local backend running in November
2026; it never accepts a hosted backend URL. It can be rerun without resetting counters.
