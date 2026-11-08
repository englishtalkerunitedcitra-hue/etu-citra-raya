# Gmail SMTP for staff invitations

The selected Supabase project is `tnbhblojvqshmsrkfvap` (ETU smart CRM dev). Application migrations and Auth policies have been installed. Both server functions are deployed with JWT verification. Google Sheets delivery remains disabled. The first app-admin email was supplied privately in chat; no real user invitation has been sent yet.

Gmail was selected as the invitation sender. Complete the following directly in your own Google/Supabase account; do not put any password in chat, repository files, frontend config, or PR comments.

1. Enable 2-Step Verification on the Gmail account.
2. Open https://myaccount.google.com/apppasswords and create an App Password named `ETU Supabase`.
3. Open https://supabase.com/dashboard/project/tnbhblojvqshmsrkfvap/auth/smtp and enable custom SMTP.
4. Enter these settings together and save:

   | Field | Value |
   | --- | --- |
   | Sender email | The Gmail address selected for ETU invitations |
   | Sender name | ETU Citra Raya |
   | Host | smtp.gmail.com |
   | Port | 465 |
   | Username | The same complete Gmail address |
   | Password | The Google App Password, entered only in Supabase's secure password field |

5. Report that SMTP is saved, without sharing the password. We can then verify readiness and prepare a single admin invitation once the staff page is available at the approved callback URL.

Supabase currently has no custom SMTP configured. Its default email service has recipient restrictions and should not be assumed to deliver to arbitrary staff addresses. If App Passwords is unavailable for the chosen Google account, use a supported transactional SMTP provider instead; do not enter the account's normal password or weaken its security settings.

The configured invitation/recovery callback is `https://englishtalkerunitedcitra-hue.github.io/etu-citra-raya/staff/`. That page remains on the unmerged feature branch. Sending an invite before the callback page is published would not provide a usable password-setup flow, so actual invitations must wait for the reviewed frontend deployment. This does not affect public anonymous trial booking.

The cloud environment's draft also includes `tnbhblojvqshmsrkfvap.supabase.co`; review/save and publish the environment to apply it before direct hosted Auth/API verification from this chat. Management API deployment and server-side privilege inspection have already succeeded.
