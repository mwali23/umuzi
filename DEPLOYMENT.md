# Deploy Umuzi: GitHub → Supabase → Vercel

Keep the earlier prototype private. Do not invite family members until the acceptance checklist below passes. A successful frontend build alone does not mean authentication and database security are working in production.

## 1. Source on GitHub

Use this repository as the source. It contains application code and database definitions, not family data. Review changes before merging. Enable GitHub account 2FA, Dependabot/security alerts, and secret scanning/push protection where available. Protect `main` with the `verify` check and reviews when a second maintainer is available. Do not enable automatic merging of unreviewed dependency updates.

No Supabase secret or Vercel token is required in GitHub Actions. Never put database exports, screenshots with family data, `.env.local`, access tokens, or connection strings into issues, commits, logs, or pull requests.

## 2. Create the private Supabase project

1. Create a dedicated project in your Supabase account, in an appropriate region. Store its strong database password in your password manager; do not paste it into chat or the app.
2. In the SQL editor, run `supabase/migrations/202609250001_umuzi.sql` once. It creates the tables, permissions, approval/claim functions, and audit trail in one transaction. If tables already exist, stop and review a migration plan rather than deleting them or rerunning the initial schema.
3. In API settings, keep the exposed schema as `public`. **Do not expose the `private` schema.** There are no buckets or public storage assets to configure.
4. Copy the project URL and the **publishable** key (`sb_publishable_…`) for Vercel. These are intentionally public identifiers. The app rejects service-role/secret keys. The database password and `sb_secret_…`/service-role keys must remain private and are not needed by Umuzi's frontend.
5. Keep email authentication enabled. Disable anonymous sign-in and unused providers. Require verified email. Enable TOTP multi-factor authentication; Umuzi requires AAL2 for admin actions and restricted data.

## 3. Configure email and bot protection

1. Configure custom SMTP in Supabase with a verified sending domain and the mail provider's recommended DNS authentication. Enter SMTP credentials only in the Supabase dashboard.
2. Change the **Magic Link** email template to include a code, for example:

```html
<h2>Your Umuzi sign-in code</h2>
<p>Enter this code in Umuzi: {{ .Token }}</p>
<p>If you did not request this email, you can ignore it.</p>
```

3. Set a short email-code expiry (for example 10 minutes) and appropriate authentication rate limits. Test delivery and expiry, including spam folders. The default Supabase mail service is intended for limited testing and may restrict recipients; configure SMTP before inviting relatives. See [SMTP documentation](https://supabase.com/docs/guides/auth/auth-smtp) and [email-code authentication](https://supabase.com/docs/guides/auth/auth-email-passwordless).
4. Create a Cloudflare Turnstile widget for the production domain. Set its **secret key in Supabase Auth's CAPTCHA settings**, not Vercel or GitHub. Enable CAPTCHA there. Set only its public site key in Vercel as `VITE_TURNSTILE_SITE_KEY`. Use a separate test widget for localhost. Do not turn CAPTCHA off just because a deployment has a configuration error.
5. Protect Supabase, Vercel, GitHub, and your email provider accounts with MFA. Do not share administrator accounts.

## 4. Import the repository into Vercel

1. Add New Project → import your Umuzi GitHub repository. Use the Vite preset, Node 24, `npm run build`, output directory `dist`. The repository root is the project root.
2. Add these build-time environment variables for **Production**:

| Variable                        | Value                           | Public? |
| ------------------------------- | ------------------------------- | ------- |
| `VITE_SUPABASE_URL`             | Your HTTPS Supabase project URL | Yes     |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Your `sb_publishable_…` key     | Yes     |
| `VITE_TURNSTILE_SITE_KEY`       | Turnstile public site key       | Yes     |

Everything prefixed `VITE_` is bundled into browser JavaScript. Do not put any private secret in these fields. No backend secret is required in Vercel for this MVP.

3. Deploy. After environment changes, redeploy: these variables are compiled at build time.
4. In Supabase Auth URL settings, set the exact production URL. Avoid broad wildcard redirects. This app uses typed codes, not login tokens in URLs. Update the Turnstile allowed hostname to match.
5. Review `vercel.json` security headers. Prefer narrowing `connect-src https://*.supabase.co` to your exact project hostname after setup. Do not weaken `script-src` with `unsafe-inline` or `unsafe-eval`. `style-src` allows inline styles for UI compatibility, not executable scripts.
6. Use a separate Supabase project and SMTP/CAPTCHA test settings for preview/development deployments. Do not give unreviewed pull-request code production database access. Without preview variables, the app displays its safe setup screen.

See [Vercel's Vite deployment guide](https://vercel.com/docs/frameworks/frontend/vite). The Hobby plan is for personal, non-commercial projects; confirm current [plan limits](https://vercel.com/docs/plans/hobby). Free-tier hosting and email availability are not guaranteed indefinitely.

## 5. Become the first administrator

1. Open the deployed app, enter your email, verify the code, and submit your membership request.
2. In Supabase Authentication → Users, find **your own verified account** and copy its UUID. Do not use a ChatGPT/Sites account ID or choose another person's account.
3. Open `supabase/bootstrap-admin.sql` in the Supabase SQL editor. Replace its UUID placeholder locally in the editor with your verified auth user ID. Review the target, then run it. The script fails if you have not verified your email and requested membership.
4. Return to Umuzi and choose “Check approval.” Open Admin, set up an authenticator, and verify its code. Do not share or commit the setup QR code/secret.
5. Add a second trusted administrator after they sign in and request access. In Admin, approve their account and then “Make admin.” They must set up their own authenticator. Admins cannot modify their own access through the app.

There is deliberately no “first signup becomes admin” shortcut. If an authenticator is lost, a project owner must verify identity out of band and use Supabase's documented factor-recovery process; never weaken the app's AAL2 checks as a workaround.

## 6. Required acceptance checks before invitations

Use synthetic people and separate test accounts, not real sensitive records.

- [ ] Fresh signed-out browser: no family names, claims, medical fields, or account lists are accessible, including via the REST API.
- [ ] New verified account remains pending and cannot fetch `people` or mutate records directly.
- [ ] Admin without authenticator verification cannot approve accounts/claims or read restricted data.
- [ ] Admin approval lets the member see the tree. Claiming does not automatically edit or duplicate a person.
- [ ] Approve a claim; only that claimant and verified admins can edit that profile. A competing claim cannot take over.
- [ ] Create parent and child; connection stays pending until approved; reload and check the actual edge.
- [ ] Re-enter the same name with different case/spaces: no duplicate is created. Review same-name different-person exceptions explicitly.
- [ ] Reject a cycle and self-link; try a stale edit; confirm errors do not show a false save.
- [ ] Suspended account loses access on its next API request even with an existing auth token. Already viewed content cannot be recalled.
- [ ] OTP, CAPTCHA, and authenticator setup work in desktop and mobile browsers. Inspect production CSP and HTTPS headers.
- [ ] Restricted death information is absent from ordinary member responses and from shared biographies.
- [ ] Create an encrypted backup and successfully restore it to a separate test project. Verify access rules after restore.

Keep the original Site private. There is no automatic export/import of its records; inspect and deduplicate any real records before a separate migration.

## 7. Operate it safely

Assign a family privacy contact and explain what approved members can see. Obtain appropriate consent, especially for living people, children, tribe/community identity, and medical information. Keep uncertain facts blank. Agree on correction and deletion procedures before collecting sensitive information.

Review pending memberships/claims personally. Check Supabase auth logs, database/audit activity, dependency alerts, and usage limits. The current app allows 60 successful writes per account per hour; provider auth rate limits/CAPTCHA are still required against failed attempts and signup abuse.

Schedule encrypted off-site backups and test restores. Free Supabase projects require a deliberate export/backup strategy; see [backup guidance](https://supabase.com/docs/guides/platform/backups). Keep backups outside GitHub and the webroot. Check the current [production checklist](https://supabase.com/docs/guides/deployment/going-into-prod) for your chosen plan.

For updates: review the diff → run checks → apply reviewed additive database migrations → deploy compatible app code → smoke-test. A Vercel rollback does not undo database migrations. Back up before schema changes. Do not change migrations that have already been applied to a live project.
