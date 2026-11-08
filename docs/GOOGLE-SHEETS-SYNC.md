# Google Sheet synchronization — ETU

Target workbook supplied by ETU:

https://docs.google.com/spreadsheets/d/1zi-DybtGZDHgWVEPt1xpGXWQgKixxIPQQPZg6nIsDHg/edit

## What this implements

The shared database remains the source of truth. A transactional outbox copies Master Prospek and Log Aktivitas **one way, database → Google Sheet**. Changes made directly in a Sheet are not imported into the app. Staff/customer login, public booking, and existing analytics are unchanged.

The worker creates two dedicated tabs inside the supplied workbook:

- `ETU App - Master Prospek`
- `ETU App - Log Aktivitas`

Original tabs and their manual data are not renamed, cleared, adopted, or overwritten. Existing tabs with these names must carry the app's developer-metadata ownership marker and matching headers; otherwise the worker stops. Choose different names in the server config if there is a collision. The original workbook structure could not yet be inspected: the current cloud network denied Google Docs/Sheets access, and there is no confirmed Google editor identity for this file. The integration therefore does not assume or alter the original template's columns.

Master rows contain Lead ID, DB version, name/contact, program, PIC, separate selling step/sales stage/customer response, priority/Dorman, dates, next action, notes, and creator/updater identity/timestamps. Activity rows contain stable Activity ID, Lead ID, actor, time, follow-up note, and before/after changes. See `supabase/functions/sheets-sync/mapping.js` for exact headers.

## Production prerequisites — still required

The existing ETU development project `tnbhblojvqshmsrkfvap` has been selected and restored; application migrations/Auth configuration are still pending. A Sheet URL alone is not write authorization. Complete `STAFF-SETUP.md` first, then:

1. In a Google Cloud project owned by ETU, enable **Google Sheets API** and create a dedicated service account. A Drive-wide scope is not required.
2. In this workbook's **Share / Bagikan** dialog, add the service account's `client_email` as **Editor**. Do not make the workbook public. Keep access to the full workbook restricted to the admin/authorized viewers: Google Sheet sharing does not reproduce the application's per-PIC row-level permissions.
3. Create a JSON key for that service account. Put its complete JSON only in **Supabase Dashboard → Edge Functions → Secrets**, named `GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON`. Do not send the JSON/private key in chat, commit it, put it in `staff/config.js`, or use a public Apps Script endpoint. The worker signs a short-lived JWT server-side and sends it only to Google's fixed OAuth endpoint with the Sheets scope.
4. Apply migration `202611080002_google_sheets_sync.sql` with `supabase db push`, after reviewing the existing staff migration. It creates the outbox, backfills existing DB records, and sets the supplied workbook ID with synchronization **disabled** by default.
5. Deploy `supabase functions deploy sheets-sync` with JWT verification enabled. Keep `STAFF_ALLOWED_ORIGINS` set to the approved website origin, as for `staff-admin`. Supabase supplies the service-role credential server-side; it is not placed in the browser.
6. When ready to write into the two new tabs, enable the server config in Supabase's trusted SQL editor:

   ```sql
   update public.sheet_sync_config set enabled = true where singleton;
   ```

7. Log in as an active Admin and click **Sinkronkan Sheet**. Staff/anonymous users cannot invoke a full-workbook sync. Verify the two new tabs, Lead ID/version, one activity row, and dashboard confirmation. A quota/access/header error leaves data pending and does not report it as synchronized.

No Google key or hosted Supabase credential was available during implementation. These deployment/permission steps have **not** been run against the supplied workbook. If ETU already has a suitable service account, use its email for sharing rather than creating a duplicate account. Only its email/project URL may be shared in chat; keep keys in secure settings.

## Schedule automatic sync

Use Supabase Cron to call the Edge Function every minute, or use the admin button manually. For scheduled calls create a random secret of at least 32 characters, set it as Edge Function secret `SHEETS_SYNC_JOB_TOKEN`, and store the same value in Supabase Vault. Scheduled calls require **both** a service-role JWT Authorization header and this separate `x-job-token`; neither belongs in client code.

With the Supabase `pg_cron`, `pg_net`, and Vault features enabled, create Vault secrets through the Dashboard named `etu_project_url`, `etu_service_role_jwt`, and `etu_sheet_job_token`. Then the reviewed job can refer to them without hardcoding values:

```sql
select cron.schedule('etu-sheets-sync', '* * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='etu_project_url') || '/functions/v1/sheets-sync',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='etu_service_role_jwt'),
      'x-job-token',(select decrypted_secret from vault.decrypted_secrets where name='etu_sheet_job_token')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 90000
  );
$$);
```

This job is a deployment step for the ETU project owner; it has not been installed automatically. Do not put decrypted secrets or scheduler headers into a PR/comment/log. Review Cron failures/Edge Function status without logging lead payloads or OAuth tokens.

## Delivery and recovery behavior

- Saving a lead writes the master, audit log, and queue in the same DB transaction. Google availability never enters that save transaction.
- Each entity has a stable assigned Sheet row and ID; retries use `values.batchUpdate` at exact ranges, not `append`. A crash after Google writes but before DB acknowledgement can be retried at the same rows without duplicate lead/activity rows.
- Master payload/version is updated to the latest DB record. If the DB changes while an older batch is in flight, acknowledging the older version leaves the newer version pending.
- A single 180-second worker lease protects batches of at most 25 rows. External calls have explicit timeouts; the worker refuses to begin a write after its 60-second pre-write budget. Expired worker acknowledgements are rejected. This is retryable delivery, not a claim of an atomic cross-provider transaction.
- Only an explicit valid Google acknowledgement for the expected workbook, ranges, row/cell counts is recorded as confirmed. HTTP 2xx alone is insufficient. A DB acknowledgement failure also leaves safe retry work.
- Provider denial, quota/server errors, missing ownership, incorrect headers, and uncertain outcomes stay pending. Retries back off; `Retry-After` is respected (up to one day). Errors exposed to the dashboard are safe codes/counts, not lead data or raw Google responses.
- Writes use `RAW`, so a customer's name/contact starting with `=` remains text rather than executing a Sheet formula.
- Do not delete/reorder/insert rows inside the two app-owned tabs. Sorting/filtering should use filter views. The worker checks tab ownership and headers; it does not detect every manual row move. Dedicated tabs are application-managed, and manual edits there may be overwritten by the next DB update. Keep existing manual workflow in the original tabs.
- If a previously synchronized tab is deleted, the worker stops rather than silently recreating it with missing historical rows. Disable sync and restore that tab from Google version history, or deliberately choose a new destination and reset/requeue all confirmations under admin/operator supervision. Changing workbook/tab config is not a casual UI operation.
- There is no Sheet → DB import, deletion sync, or migration of existing manual leads in this change. Those require a separate reviewed mapping/import step to avoid duplicate identities.

## Dashboard meaning

`Google Sheet: menunggu aktivasi` means the server config is disabled. Pending/failed counts describe entities visible to the logged-in user. An admin can see the team's counts, while staff cannot inspect another PIC's outbox. Confirmed counts/timestamps are read from the server after provider acknowledgement; a successful lead save only says that the DB saved and Sheet delivery is queued. No Google secret is returned to the browser.

## Verification performed and limitations

- 13 Deno tests use a simulated Google transport to verify RAW mapping, stable-row retries after ambiguous results, response validation, header/ownership protection, busy/disabled workers, DB-acknowledgement failure, and Google-only OAuth signing/scopes.
- Local real PostgreSQL/Auth tests verify transactional queueing, service-only worker RPCs, per-PIC status, leases, version fencing, stable rows, and retry states. Google acknowledgements are deliberately simulated in that DB test; no live Sheet write is implied.
- Staff/browser regression checks still exercise invitation, real shared saves across separate browsers, unauthorized access rejection, and public booking without login.
- **Live Google Sheet read/write, Google permission grant, hosted scheduling, and production deployment remain unverified** until the service account and ETU backend are configured. Network additions for `docs.google.com`, `sheets.googleapis.com`, and `oauth2.googleapis.com` were saved in the cloud environment draft; review/save and publish that environment if you want this cloud session to perform live verification.

Commands after installing the existing test dependencies:

```sh
npm run build:staff
npm test
npm run test:sheets
# With the disposable local stack running and static site on 127.0.0.1:8000:
ETU_LOCAL_BACKEND_STATUS=/tmp/etu-staff-local/status.json npm run test:integration
ETU_LOCAL_BACKEND_STATUS=/tmp/etu-staff-local/status.json python3 tests/sheets_outbox_integration.py
```
