# Master Prospek template adoption (review before deployment)

Source: ETU Selling Process Monitoring, original Master Prospek tab, gid `2127889910`.
The 25 column labels were read directly from the source header range on 12 November 2026.
This change adopts the template's information model; it does not import historical rows,
write to the original tab, or connect the existing workbook dashboard formulas.

## Column mapping

| Source column | Application storage |
| --- | --- |
| Lead ID | `sales_leads.id` (UUID); original identifiers retained separately as `master_details.legacy_lead_id` |
| Tanggal Masuk | `master_details.entered_on`; export fallback is created date in WIB |
| Nama Parent | `master_details.parent_name` |
| Nama Siswa | `master_details.student_name` |
| Asal Sekolah | `master_details.school` |
| Usia | `master_details.age` (integer 0–120, optional) |
| WhatsApp | `phone` |
| Domisili | `master_details.domicile` |
| Program | `program` |
| Sumber Lead | `master_details.lead_source` |
| Detail Sumber / Sekolah | `master_details.source_detail` |
| PIC | authenticated staff identity (`pic_id`); staff cannot assign another PIC |
| Current Stage | `sales_stage` |
| Temperature | `master_details.temperature` (separate from priority and response) |
| Last Contact | `last_contact_at` |
| Next Action | `next_action` |
| Next Follow-up | `follow_up_on` |
| Follow-up Count | `master_details.follow_up_count` (explicit count, not the number of all record edits) |
| Trial Date | `trial_at` |
| Trial Attendance | `master_details.trial_attendance` |
| Recommended Level | `master_details.recommended_level` |
| Recommended Schedule | `master_details.recommended_schedule` |
| Decision Barrier | `master_details.decision_barrier` |
| Registration Date | `registered_on` |
| Payment Status | `master_details.payment_status` |

The first 25 export columns match the source order and labels. Additional columns preserve
version, display name, response, priority, Dorman, selling step, notes, original Lead ID,
PIC identity and creator/updater audit metadata. The app display name is retained for old
leads; it is not silently interpreted as a parent's or student's name.

All source stage values are representable: New Lead, Contacted, Responded, Trial Offered,
Placement Test Booked, Trial Booked, Trial Attended, Follow-up After Trial, Registered,
Future Lead, Lost Lead. Existing database stage codes remain valid. Customer response,
Temperature and Dorman stay independent. Placement test bookings count as upcoming trials.

Source values such as Cold/Warm/Hot/Future, Hadir/Tidak Hadir/Reschedule and
Belum/DP/Payment 1/Lunas/Batal can be entered without lossy normalization. Source spelling
variants such as `SMall Talker`, `Chatt GPT`, and multiple social-media labels must be
reviewed before any historical import; this change does not perform such an import.

## Data integrity and access

Migration `202611120001_master_prospek_template.sql` is additive. Existing leads receive an
empty detail object; no names or historical values are guessed. The existing save RPC
validates allowed keys, string sizes, age/count and real calendar dates, and merges partial
details. Old clients omitting details preserve them. The existing server role/PIC checks,
idempotency lock, optimistic version checks, audit rows and transactional sync queue remain.
Direct client database writes remain denied. Input is exported as RAW text to Sheets.

## Release procedure — not performed by this PR

1. Review the migration, app form and mapping. Back up the application-managed Sheet tabs
   and database before changing an established export layout.
2. Pause `etu-sheets-sync` Cron and set sync config disabled; allow any active worker lease
   to finish. Preserve original Master Prospek, Log Aktivitas and Dashboard tabs.
3. Apply the additive migration; deploy the matching worker. The old worker can read the
   additive schema, but the new export layout cannot write into old headers automatically.
4. Verify ownership metadata and all current headers in the **application-owned** Master
   tab, then deliberately upgrade those headers to `MASTER_HEADERS` and requeue all master
   rows from the database for full rewriting at their existing stable positions. Stage this
   upgrade in a copied test workbook first. Do not bypass ownership/header checks or adopt
   the original manual tab merely because its title matches.
5. Publish the reviewed staff bundle, re-enable sync and Cron, and read back all master IDs,
   versions and template values. Verify a staff save and independent admin read again.
6. Original historical rows and workbook dashboard integration require a separate import
   review: deduplicate, map PIC to real accounts, reconcile original IDs and review formulas.
   No original rows or dashboard formulas are changed by this PR.

The current live website and existing 24-column export continue to operate until approval
and this coordinated release. A header mismatch fails safely rather than overwriting data.

## Validation

- 7 model tests: includes search by parent/student/school/old ID and placement-test summary.
- 15 sync tests: includes complete 25-column export, legacy display-name preservation,
  WIB date fallback and existing delivery/authorization protections.
- Local PostgreSQL 17 + real Supabase Auth/PostgREST: complete field round-trip, independent
  admin read, PIC isolation, anonymous/direct-write denial, invalid values, duplicate saves,
  stale versions, partial/old-client updates, audit and transactional outbox.
- Existing invitation, staff/mobile, admin, public Free Trial/WhatsApp and revoked-account
  integration tests. Dummy data only; WhatsApp requests intercepted.
- Real mobile form save and independent admin reopening all template fields; no dialog overflow.

Commands (disposable local backend only):

```sh
npm run build:staff
npm test
npm run test:sheets
ETU_LOCAL_BACKEND_STATUS=/tmp/etu-master-local/status.json python tests/master-prospek-integration.py
ETU_LOCAL_BACKEND_STATUS=/tmp/etu-master-local/status.json python tests/staff_integration.py
```
