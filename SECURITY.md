# Security and privacy

Umuzi is an MVP with layered safeguards, not a security certification or a promise that intrusion is impossible. Do not collect real sensitive data until the deployment checklist and an appropriate independent review are complete.

## Trust boundaries

| Actor                                    | Permitted access                                                                                                              |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Anonymous visitor                        | Static sign-in page only; no database records or RPC execution                                                                |
| Verified, unapproved account             | Request membership; read its own approval state                                                                               |
| Approved member                          | Read shared people/approved connections; create people; propose connections; request one pending profile claim                |
| Approved claimant                        | Above, plus editing their linked person only                                                                                  |
| Admin with email sign-in only            | Ordinary member capabilities; no admin queue or medical data                                                                  |
| Admin with verified authenticator (AAL2) | Approvals, claims, relationship decisions, role delegation, all profile edits, restricted death information, activity history |
| Supabase project/database owner          | Infrastructure-level access, recovery, migrations; protect separately with MFA and least privilege                            |

Authentication proves control of an email account, not family membership or identity. Admins must verify membership and profile claims outside the app using relatives they already trust. An approved account does not automatically claim a matching name. Trusted administrators can approve their own claims; administrator trust is an explicit boundary of this single-family MVP.

RLS is enabled on every application table. Browser roles have no direct write grants. `public.umuzi` is a security-invoker wrapper; the guarded implementation lives in `private`, which must not be an exposed API schema. Privileged functions pin an empty `search_path` and fully qualify tables. Helpers cannot promote accounts. Roles come from the protected membership table, never user-editable auth metadata.

Every mutation is transactional and uses a transaction advisory lock to serialize checks in this small-family MVP. There are database constraints for exclusive approved claims, relationships, field lengths, and date consistency; approval checks prevent ancestry cycles. Optimistic version checking rejects stale profile edits. Identity-name duplicates are checked inside the same serialized transaction; documented admin exceptions allow genuine homonyms. Spellings, aliases, and incomplete historical records still need human review.

Member status is looked up on each request, not copied into a long-lived JWT role. Suspension stops new backend reads/writes immediately. It does not erase data someone already saw, copied, exported, or photographed. The browser clears its loaded tree when a refreshed request loses membership; foreground focus and a 60-second refresh also check access.

## Browser and secret handling

- Public Supabase URL and publishable key are expected to be visible. RLS and grants protect records, not key obscurity.
- No service-role key, database password, SMTP password, or provider access token belongs in browser code, Vercel's `VITE_` variables, or Git history.
- Sessions are stored in browser `sessionStorage`, not long-lived localStorage. Sign out on shared devices. Tokens are JavaScript-readable: a successful XSS could steal an active session. Static hosting, escaped React text (no raw HTML), no third-party analytics, dependency updates, and CSP reduce but do not eliminate this risk. Closing/restoring browser windows can have browser-specific session behavior.
- Only the public Turnstile widget is loaded from a third-party script provider. Its private key belongs in Supabase Auth settings. Auth rate limiting and CAPTCHA are deployment requirements.
- API calls use bearer tokens, not cross-site cookies. Umuzi has no cookie-authenticated custom mutation endpoints. Hosting must serve HTTPS and the configured security headers.
- Source credential scanning is heuristic. A clean scan is not proof that every secret is absent. If any credential was previously committed or shared, rotate it; deleting the text is insufficient.

## Sensitive family information

Approved members can see shared profile dates, places, tribe/community, occupation, biography, and connections. There are no per-person or child-specific visibility rules yet. Do not collect details you are not comfortable sharing with every approved member. Tribe/community is optional and must be self-described or sourced respectfully, not inferred.

Cause of death and its source/permission note live in a separate table accessible only to MFA-verified admins. This is access control, **not end-to-end encryption**: database operators and authorized backups can contain it. Keep it blank unless there is a legitimate need and suitable permission. Administrators can remove it by saving an empty cause. Shared biographies must not contain medical information; this is a user policy, not an automated content filter.

Stats use only recorded, approved links. Ancestor counts include adoptive and step connections as labeled, not genetic inference. Birthplaces are free text and may overcount inconsistent spellings. Counts describe incomplete records; they do not predict health, ability, life outcomes, ethnicity, or a person's future.

## Limits and operations

- One family per database, not multi-tenant. Do not host unrelated families in the same instance.
- The graph loads the family dataset into memory. Validate performance before large imports; no pagination or sophisticated genealogy layout yet.
- Members may add inaccurate records. Connection moderation, audit events, claimed-profile edit restrictions, and admin review help, but admins and approved members remain trusted participants.
- Audit rows store actors/actions/targets and same-name exception reasons, not full before/after record content. They are append-only to browser roles, not tamper-proof against a database owner. No automatic breach detection is implemented.
- There is no duplicate-merge or general person-delete UI. Do not improvise a bulk delete. For a correction/deletion request, verify authority, take a private backup if retention is appropriate, review affected relations/claims, and use a transactional operation in the SQL editor. Apply backup-retention and privacy obligations too. Build a reviewed merge tool before importing a large archive.
- Dependency audits and PGlite tests do not test provider configuration, email delivery, JWT signature verification, network/transport security, real concurrent sessions, or every possible attack. Run the hosted acceptance checks. Consider independent security review before medical or children's information is collected.

## Incident response

1. If access is suspect, suspend the affected member through a verified administrator and revoke their sessions in Supabase. Keep the first administrator reachable through a separate trusted channel.
2. If an infrastructure account/key is compromised, use provider controls to restrict access and rotate the actual affected credential. Review logs and scope before taking destructive action.
3. Preserve necessary audit evidence securely; never post real data or tokens in public issues. Notify affected people as appropriate to the situation and applicable requirements.
4. Fix and test in an isolated project, restore only from verified backups, and recheck RLS/grants after recovery.

For a potential vulnerability, use a private GitHub security advisory if the repository offers it. Otherwise ask the maintainer for a private reporting channel without including exploit details, real family data, or secrets in a public issue.

Primary references: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [API security](https://supabase.com/docs/guides/api/securing-your-api), [TOTP MFA](https://supabase.com/docs/guides/auth/auth-mfa/totp), [production checklist](https://supabase.com/docs/guides/deployment/going-into-prod).
