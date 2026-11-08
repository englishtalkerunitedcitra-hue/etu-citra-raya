# ETU ruang staf — audit, setup, and review

## Audit and scope

The existing site is static HTML/CSS/JavaScript on GitHub Pages, publishing `main` from `/`. There was no backend, authentication, shared lead storage, or AGENTS.md in this checkout. The public Free Trial form prepares a WhatsApp message; GA4 receives non-identifying interaction events. It does **not** create a lead in shared storage. The public files and booking behavior are unchanged by this feature.

`staff/` adds a vanilla JavaScript app using the official Supabase JS SDK bundled locally. No framework migration, public signup, analytics, third-party fonts, or lead-data browser cache is added to the staff app. Login sessions use sessionStorage per browser tab. Public programs and trial remain anonymous. Staff enter WhatsApp/public trial inquiries manually into Master Prospek; automatic capture is not implemented or implied.

GitHub Pages serves only the UI. Supabase Auth, PostgreSQL, RLS, transactional RPCs and one Edge Function provide the shared backend. Staff see/write their assigned leads. Active admins can see all leads, reassign PICs, invite staff, change roles and disable access. A disabled account's existing JWT loses DB access immediately because policies check the live profile, not a role in the token or browser.

## Required production configuration (not yet provisioned)

Create one Supabase project owned by ETU. Do not send secret values in chat, commit them, put them into HTML, or place them in `staff/config.js`.

| Setting | Where | Purpose |
| --- | --- | --- |
| Project URL (`https://<ref>.supabase.co`) | Public `staff/config.js`, via `SUPABASE_URL` when running the config generator | Browser/API endpoint; not secret |
| Anon JWT or `sb_publishable_…` key | Public `staff/config.js`, via `SUPABASE_PUBLISHABLE_KEY` when running the generator | Public browser key; RLS provides authorization |
| Service-role key | Supabase Edge Function's automatically provided `SUPABASE_SERVICE_ROLE_KEY` only | Admin invitation endpoint; never sent to browser |
| CLI access token | Local secure shell / CI secret `SUPABASE_ACCESS_TOKEN` | Link and deploy migrations/function |
| Project DB password | Local secure shell / CI secret `SUPABASE_DB_PASSWORD` | Apply migration; never frontend |
| SMTP host, port, sender, username/password | Supabase Auth → SMTP settings | Deliver invitations/recovery to each staff member's personal email |
| `STAFF_ALLOWED_ORIGINS` | Supabase Edge Function secret/settings | `https://englishtalkerunitedcitra-hue.github.io` (origin has no repository path) |
| `STAFF_REDIRECT_URL` | Supabase Edge Function secret/settings | `https://englishtalkerunitedcitra-hue.github.io/etu-citra-raya/staff/` |
| Auth Site URL + redirect allowlist | Supabase Auth → URL Configuration | Exact full staff URL above; add only approved preview URLs |
| Disable new user signup, email signup, anonymous login | Supabase Auth settings | Invitation-only accounts. Local config has both signup switches disabled; remote Dashboard settings must also be applied. |
| Minimum password length 12; refresh rotation enabled | Supabase Auth settings | Match tested local policy |

The current checked-in public config is empty and fails closed with a setup notice. No fake saving or localStorage dashboard is substituted. No Supabase project exists yet; ETU must create/own it before production can work. Enable MFA for privileged accounts if ETU policy requires it; this initial UI does not provide MFA enrollment.

### Deploy backend after configuration and code review

1. `npm ci` (Node 22+). The npm Supabase CLI downloader uses npm proxy settings; in this managed cloud use `npm_config_https_proxy="$HTTPS_PROXY" npm ci --cache /tmp/etu-npm-cache` if its downloader otherwise fails DNS. TLS and artifact checksums remain enabled.
2. `npx supabase login` on your own secure terminal, or supply `SUPABASE_ACCESS_TOKEN` securely. `npx supabase link --project-ref <ref>`; use the DB password securely, not in a committed file.
3. Review `supabase/migrations/202611080001_staff_monitoring.sql`, then `npx supabase db push`. Do not run `db reset` against production.
4. Apply the Auth settings above (local `config.toml` does **not** change hosted Auth settings). Configure custom SMTP; Supabase's default mail service may restrict recipients or rates.
5. Set `STAFF_ALLOWED_ORIGINS` and `STAFF_REDIRECT_URL` as Edge Function secrets. `npx supabase functions deploy staff-admin` with JWT verification enabled. Built-in Supabase URL, anon key and service-role key are supplied server-side. For new publishable-key projects, user sessions still carry verified JWTs to the function.
6. Bootstrap the first admin using Supabase Dashboard → Authentication → Users → Invite user. Copy that user's UUID from the Dashboard. In the trusted SQL editor, explicitly activate that user:

   ```sql
   update public.staff_profiles
   set role = 'admin', active = true
   where id = '<invited-admin-user-uuid>'::uuid;
   ```

   Verify exactly one intended row was changed. The first admin must open their invite, set a password and log in before inviting teammates. User metadata such as `role: admin` is deliberately ignored. Never bootstrap by exposing the service key in a page.
7. Run `SUPABASE_URL=<public-url> SUPABASE_PUBLISHABLE_KEY=<public-key> node scripts/configure-staff.mjs`, then `npm run build:staff`. Only public values are written; the generator rejects service-role/secret keys. Commit the public configuration after review.
8. On a reviewed preview, test customer booking, invite/password setup, staff save, admin view in another browser and anonymous/cross-PIC API denial. Only then merge the approved feature PR. GitHub Pages publishes `main`; no production merge is performed in this task.
9. Monitor failed sign-ins, email delivery and database errors. Configure database backups/retention and staff departure procedures in ETU's Supabase project. Auth recovery emails use the same exact redirect allowlist.

## Local development and meaningful checks

```sh
npm_config_https_proxy="$HTTPS_PROXY" npm ci --cache /tmp/etu-npm-cache
npm run build:staff
npm test
# Official Docker Hub distribution if the default public.ecr.aws registry is unavailable:
SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io npm run backend:start
```

For managed cloud machines using Docker's `vfs` storage driver, the full Supabase database image may require excessive temporary disk space. The tested lightweight alternative runs the same SQL migration and admin function against upstream PostgreSQL 17, Supabase GoTrue Auth and PostgREST, plus a local email catcher:

```sh
docker pull postgres:17.6-bookworm
docker pull supabase/gotrue:v2.180.0
docker pull postgrest/postgrest:v12.2.12
docker pull axllent/mailpit:v1.27.0
npm run backend:start:lite
# In a second terminal, with the static site served at 127.0.0.1:8000:
ETU_LOCAL_BACKEND_STATUS=/tmp/etu-staff-local/status.json npm run test:integration
```

The lightweight harness uses Deno 2.5.6 from npm to run the exact Edge Function source (not a mock). It supplies the standard `auth.uid()` semantics consumed by PostgREST JWT claims. All test credentials are generated per run in private `/tmp/etu-staff-local` files; none are production credentials. A loopback-only gateway routes to real Auth/REST/function services. Ctrl-C stops only its own labeled containers. It does not use Supabase CLI state or production resources. Ports 54321, 55432, 55433, 55481, 55482, 55499, and 55425 must be available. Mail catcher UI is local port 55425. The test harness is not a deployable production server.

Docker is required. The full local stack uses Supabase Auth, PostgreSQL 17, PostgREST, gateway, mail catcher and Edge runtime. Optional storage, realtime, analytics and Studio are excluded. Download time/disk use can be substantial on first run. Keep package and image verification enabled. `config.toml` disables signup and includes local-only redirect URLs.

Create ignored `supabase/.env.local` containing **only**:

```dotenv
STAFF_ALLOWED_ORIGINS=http://127.0.0.1:8000
STAFF_REDIRECT_URL=http://127.0.0.1:8000/staff/
```

Run `npx supabase functions serve staff-admin --env-file supabase/.env.local` in another terminal. Serve this checkout with `python3 -m http.server 8000 --bind 127.0.0.1`. Then run `npm run test:integration` (Python Playwright and Chromium are required). Tests target only `127.0.0.1`, create disposable dummy accounts, and temporarily write local **public anon** configuration, restoring it in `finally`. They never use real customer data or send WhatsApp messages. Test invitation emails go only to the local mail catcher. `npm run backend:stop` stops the local stack; `npm run backend:reset` destroys **local** dummy data and reapplies migrations. Do not run these tests against a hosted production project.

## Data mapping to ETU Selling Process Monitoring

The workbook URL is now available, but its original schema could not be inspected without Google network/editor access. This mapping is used for the two app-owned destination tabs. The database is the **single source of truth**. The UI reads pending/confirmed delivery counts from the server and never equates a DB save with Google confirmation.

| Master Prospek column | `sales_leads` field |
| --- | --- |
| Lead ID | `id` (UUID, stable across sessions/devices) |
| Nama / nomor kontak | `name`, `phone` |
| Program / PIC | `program`, `pic_id` (staff UUID) |
| Langkah 1C–3E–2C | `flow_step`: Connect, Explore, Educate, Experience, Closing, Care |
| Tahap penjualan | `sales_stage`: New, Contacted, Trial, Trial Attended, Registered, Lost |
| Respons customer | `response`: Unknown, Belum respons, Masih mempertimbangkan, Tertarik, Belum berminat, Minta follow-up |
| Prioritas / Dorman | `priority`, `dormant` (separate explicit reactivation flag) |
| Kontak terakhir / next action | `last_contact_at`, `next_action` |
| Tanggal follow-up / jadwal trial / registrasi | `follow_up_on`, `trial_at`, `registered_on` |
| Catatan / siapa / kapan | `notes`, `created_by`, `updated_by`, `created_at`, `updated_at`, `version` |

`lead_activities` maps to **Log Aktivitas**: unique log ID, Lead ID, actor UUID/name, timestamp, action, follow-up note, and before/after record snapshots. Logs are append-only for browser users. All visibility follows current PIC access; the prior PIC loses access after reassignment. Audit data is never sent to GA4. No delete operation is exposed.

Saves are one DB transaction: validate active membership/PIC/version → write master → append history → record idempotency request. Duplicate concurrent requests with the same user/request ID return the original result. Reusing that ID for different data is rejected. Stale edits are rejected rather than silently overwriting another device's update. A retry of the same request returns that request's original result; dashboard refresh reads the latest DB version. Top 3 is personal per day in WIB and persisted server-side; Top 15 is high priority first, then earliest follow-up, then deterministic creation/ID order, excluding Registered/Lost. Dorman remains a separate filter, not an invented response or sales stage. Summary follows current filters; “registrasi baru” counts the selected current WIB day.

The server-side Sheet worker uses a protected transactional outbox, stable row IDs, service-account credentials held only in Edge secrets, and explicit Google acknowledgements. See GOOGLE-SHEETS-SYNC.md before enabling it.

## Known limits

- Production setup/invitation delivery cannot be verified until ETU supplies its project and SMTP configuration. No automatic capture from WhatsApp or marketing automation is included. Sheet delivery is implemented but remains disabled until the Google and backend configuration is completed.
- Dashboard refreshes on demand, when tab becomes visible, and every 30 seconds while the editor is closed. A successful save is immediately shared; another device can click Muat ulang. No realtime subscription is required.
- All lead rows visible to the logged-in user are paged from the DB for dashboard sorting/filtering; this is suitable for an initial team workflow. For very large datasets, move filtering/summary into server RPCs rather than raising client limits. History UI shows the latest 100 events; complete history remains in DB.
- Public source files are unchanged. The staff path is intentionally separate and not listed in the public sitemap. Knowing `/staff/` does not grant API/database access.
- A preview, if the repository has no per-PR host, is supplied as screenshots/local verification rather than claiming a live public backend exists. Production stays untouched until review.

## Current verification outcome

On the feature branch, local end-to-end verification passed against PostgreSQL 17.6, Supabase GoTrue v2.180.0, PostgREST v12.2.12, the deployed-source admin handler running under Deno 2.5.6, and a local mail catcher. This is a real local shared backend, not a mocked API or a hosted production validation. Checks passed for:

- A real invitation email opened in a clean browser, password creation, and invitation-only staff login.
- Staff mobile lead save and admin in a separate browser seeing the same Lead ID and follow-up history.
- Customer Free Trial without login, with WhatsApp navigation intercepted locally (no message sent).
- Anonymous data denial, public signup rejection, cross-PIC lead/history isolation, denied client role escalation and direct writes.
- Concurrent duplicate saves producing one lead/log, reused request ID rejection, and stale-version conflict response.
- Private server-persisted Top 3 and admin access revocation against a previously issued JWT.
- Frontend unit tests for Top 15, filters, daily summary and WIB day handling; HTML validation and production/dev dependency audit.

The larger Supabase CLI database image could not fit comfortably with the cloud machine's Docker vfs layer copies; that attempt was stopped and its partial artifacts removed before the lightweight integration test. No production project, SMTP delivery to real staff, Google Sheet synchronization or live staff deployment has been validated.

## Google Sheet integration

A disabled-by-default, one-way delivery worker and transactional outbox are now implemented for the workbook supplied after the initial staff PR. The database remains the source of truth. See [GOOGLE-SHEETS-SYNC.md](GOOGLE-SHEETS-SYNC.md) for exact permissions, secrets, dedicated-tab protection, scheduling, tests, and activation. Live Google synchronization is still not activated or verified.
