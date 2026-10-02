# Service queue setup

This project is a static GitHub Pages site backed by Supabase. Never put the Supabase `service_role` key in this repository or in browser code.

## Configure Supabase

1. Create a Supabase project and copy the Project URL and publishable/anon key.
2. Replace the placeholders in `assets/supabase-config.js` with the Project URL and publishable/anon key. These are public browser credentials; database RLS is the security boundary.
3. Run `migrations/202610020001_service_queue.sql` in the Supabase SQL Editor.
4. In Supabase Auth, disable public sign-ups. Invite the technician account by email and set a strong password. Enable App Authenticator (TOTP) MFA and disable Phone MFA for the project.
5. Add only the technician's Auth user ID to the admin allowlist, from the SQL Editor:

   ```sql
   insert into public.queue_admins (user_id)
   select id from auth.users where email = 'technician@example.com';
   ```

6. Install the Supabase CLI, log in, link the project, then deploy both Edge Functions:

   ```powershell
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   supabase functions deploy submit-queue
   supabase functions deploy lookup-queue
   ```

   The functions allow the GitHub Pages origin by default. If the site uses a custom domain, set its exact HTTPS origin before deploying:

   ```powershell
   supabase secrets set SITE_ORIGIN=https://your-domain.example
   ```

7. Open `https://shidosaiga.github.io/parkkreat_Computer/#staff`, sign in with the invited technician email/password, scan the displayed QR code using Google Authenticator, Microsoft Authenticator, or another TOTP app, then enter the current six-digit code. This enrolls and verifies the authenticator. Later sign-ins require a fresh six-digit code.
8. Set the GitHub Pages site URL under Supabase Auth > URL Configuration as the Site URL and an allowed redirect URL. Password login does not need email redirects, but this avoids Auth URL warnings.
9. Push the changed site to GitHub. The Pages workflow deploys it automatically.

The Edge Functions use the Supabase project URL and service-role secret from the function runtime. Do not manually copy that secret into `index.html`, `assets/supabase-config.js`, GitHub Pages files, or Git history.

## Queue behavior

- Customer requests are saved as `WAIT`; server-side code calculates the estimate and uploads up to four private images.
- Customers look up only ticket status, estimate, and timestamps using the phone number and high-entropy ticket code. The lookup does not reveal customer name, symptoms, device, task details, or image paths.
- The technician signs into `index.html#staff` with email/password and TOTP. Database and Storage restrictive policies require the user ID to be in `queue_admins`, a JWT `aal2` claim, and a `totp` method in the JWT `amr` claim before reading private requests, signing image URLs, or updating status to `PROCESS`, `FINISH`, or `CANCEL`.
- The printable estimate is shown only after Supabase confirms the request was saved. Print/PDF is a customer copy, not proof of payment.

## Operational notes

The project needs email/password Auth to remain restricted to invited users. Keep the admin allowlist to the technician account only. Store the authenticator recovery method/device safely. For production, enable Supabase Auth rate limits and configure CAPTCHA/abuse protection for the public submission function; public queue lookup is intentionally limited to a high-entropy ticket code plus phone number.