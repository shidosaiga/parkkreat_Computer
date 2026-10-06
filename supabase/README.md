# Service queue setup

This project is a static GitHub Pages site backed by Supabase. Never put the Supabase `service_role` key in this repository or in browser code.

## Configure Supabase

1. The existing project's Project URL and publishable key are configured in `assets/supabase-config.js`. If the key is rotated, copy the replacement from Project Settings > API Keys and update that file. Do not use the database password or the `service_role`/secret key here. The publishable key is intended for browser use; database RLS is the security boundary.
2. Migration `migrations/202610020001_service_queue.sql` is applied to the existing project. Run it when setting up a fresh project.
3. The owner account already in `queue_admins` is kept as the owner by migration `202610060003_queue_staff_approval.sql`; any other existing members become technicians. The migration adds separate owner checks and a signup approval check.
4. On the deployed site, a technician can request an account from **TECHNICIAN → สมัครบัญชีช่าง · รออนุมัติ**. They must verify the email. Signup alone does not add the Auth user to `queue_admins`, so the account cannot read or change queues until the owner approves it from the local dashboard after TOTP sign-in.
5. The Supabase CLI is a project dev dependency. On Windows PowerShell, log in, link the project, apply pending migrations, and deploy the account-management Edge Function:

   ```powershell
   npx.cmd supabase login
   npx.cmd supabase link --project-ref solquuycchhumpyrsppr
   npx.cmd supabase db push
   npx.cmd supabase functions deploy manage-queue-staff
   npx.cmd supabase functions deploy submit-queue
   npx.cmd supabase functions deploy lookup-queue
   ```

   In the Supabase Dashboard, open **Authentication → Sign In / Providers → Email** and enable email signups and email confirmation. Keep the custom SMTP settings already in use. `config.toml` enables email signup for local Supabase; change the hosted project's signup switch in the Dashboard so other hosted Auth settings are not overwritten.

   Public-site functions allow the GitHub Pages origin by default. `manage-queue-staff` also allows the local dashboard at `http://127.0.0.1:5173` and `http://localhost:5173`. If the site uses a custom domain, set its exact HTTPS origin before deploying:

   ```powershell
   npx.cmd supabase secrets set SITE_ORIGIN=https://your-domain.example
   ```

6. Set Supabase Auth Site URL and the GitHub Pages redirect URL to allow `https://shidosaiga.github.io/parkkreat_Computer/`.
7. Push the changed site to GitHub. The Pages workflow deploys it automatically.

The account-management Edge Function checks the caller's email-confirmed Auth session, owner role, and verified TOTP before using the service-role key to list accounts or approve/revoke technician access. The key stays in the Supabase function runtime. Do not manually copy it into `index.html`, `assets/supabase-config.js`, GitHub Pages files, or Git history.

## Queue behavior

- Customer requests are saved as `WAIT`; server-side code calculates the estimate and uploads up to four private images.
- Customers look up only ticket status, estimate, and timestamps using the phone number and high-entropy ticket code. The lookup does not reveal customer name, symptoms, device, task details, or image paths.
- The technician dashboard subscribes to Supabase Realtime for new queue requests, status changes, and deletions. If the realtime connection drops, the page refreshes the queue every 15 seconds until it reconnects.
- Public website visits are recorded as anonymous random browser/session identifiers and event types only. Names, emails, IP addresses, and URLs are not written to the analytics table. The local dashboard can show approximate unique browsers, page views, and engaged sessions after the website tracker is deployed.
- The technician signs into `index.html#staff` with email/password and TOTP. Database and Storage restrictive policies require the user ID to be in `queue_admins`, a JWT `aal2` claim, and a `totp` method in the JWT `amr` claim before reading private requests, signing image URLs, or updating status to `PROCESS`, `FINISH`, or `CANCEL`.
- Cancelled and finished requests use a configurable `delete_after_at` schedule. The local-only React admin dashboard can set retention in minutes; `0` disables automatic deletion. The scheduled Edge Function removes expired rows and their private photos.
- The printable estimate is shown only after Supabase confirms the request was saved. Print/PDF is a customer copy, not proof of payment.

## Operational notes

Public email/password registration is enabled only to collect technician requests. Every unapproved account remains outside `queue_admins` and has no queue access. The owner must approve confirmed emails in the local dashboard; revoking removes queue access without deleting the Auth account. Store the owner's authenticator recovery method/device safely. For production, enable Supabase Auth rate limits and configure CAPTCHA/abuse protection for public forms; public queue lookup is intentionally limited to a high-entropy ticket code plus phone number.
