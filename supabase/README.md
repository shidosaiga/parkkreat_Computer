# Service queue setup

This project is a static GitHub Pages site backed by Supabase. Never put the Supabase `service_role` key in this repository or in browser code.

## Configure Supabase

1. The existing project's Project URL and publishable key are configured in `assets/supabase-config.js`. If the key is rotated, copy the replacement from Project Settings > API Keys and update that file. Do not use the database password or the `service_role`/secret key here. The publishable key is intended for browser use; database RLS is the security boundary.
2. Migration `migrations/202610020001_service_queue.sql` is applied to the existing project. Run it when setting up a fresh project.
3. Auth is configured to disable public sign-ups, require confirmed email, allow TOTP MFA, and disable Phone MFA. The technician invitation has been sent to the configured technician email.
4. The technician's Auth user ID is already in the `queue_admins` allowlist. Keep this allowlist restricted to the technician account.

   ```sql
   insert into public.queue_admins (user_id)
   select id from auth.users where email = 'technician@example.com';
   ```

5. The Supabase CLI is a project dev dependency. On Windows PowerShell, log in, link the project, then deploy both Edge Functions:

   ```powershell
   npx.cmd supabase login
   npx.cmd supabase link --project-ref solquuycchhumpyrsppr
   npx.cmd supabase functions deploy submit-queue
   npx.cmd supabase functions deploy lookup-queue
   ```

   The functions allow the GitHub Pages origin by default. If the site uses a custom domain, set its exact HTTPS origin before deploying:

   ```powershell
   npx.cmd supabase secrets set SITE_ORIGIN=https://your-domain.example
   ```

6. Accept the technician invitation, set a strong password, then open `https://shidosaiga.github.io/parkkreat_Computer/#staff`. Sign in, scan the displayed QR code using an authenticator app, and enter the six-digit code. This enrolls and verifies TOTP for the technician account.
7. Supabase Auth Site URL and the GitHub Pages redirect URL are configured for `https://shidosaiga.github.io/parkkreat_Computer/`.
8. Push the changed site to GitHub. The Pages workflow deploys it automatically.

The Edge Functions use the Supabase project URL and service-role secret from the function runtime. Do not manually copy that secret into `index.html`, `assets/supabase-config.js`, GitHub Pages files, or Git history.

## Queue behavior

- Customer requests are saved as `WAIT`; server-side code calculates the estimate and uploads up to four private images.
- Customers look up only ticket status, estimate, and timestamps using the phone number and high-entropy ticket code. The lookup does not reveal customer name, symptoms, device, task details, or image paths.
- The technician signs into `index.html#staff` with email/password and TOTP. Database and Storage restrictive policies require the user ID to be in `queue_admins`, a JWT `aal2` claim, and a `totp` method in the JWT `amr` claim before reading private requests, signing image URLs, or updating status to `PROCESS`, `FINISH`, or `CANCEL`.
- The printable estimate is shown only after Supabase confirms the request was saved. Print/PDF is a customer copy, not proof of payment.

## Operational notes

The project needs email/password Auth to remain restricted to invited users. Keep the admin allowlist to the technician account only. Store the authenticator recovery method/device safely. For production, enable Supabase Auth rate limits and configure CAPTCHA/abuse protection for the public submission function; public queue lookup is intentionally limited to a high-entropy ticket code plus phone number.
