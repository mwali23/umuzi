# Umuzi

A small, private family archive. Open-source code; private family data.

**MVP status:** implemented and locally tested; a Supabase project and hosting configuration are required before real family signups. This repository contains no production database, keys, accounts, or real family records. It does not migrate data from an earlier prototype automatically.

## The family journey

Email code → request account approval → administrator approves → search the tree → request a profile claim → administrator verifies the claim.

An account and a person record are deliberately different things. Multiple relatives can connect an existing person without creating another person. Only an approved claimant or verified administrator can edit that person's profile. Approved members can add people and propose connections; administrators review connections before they appear.

- Simple email-code signup and login, no password to remember.
- Pending, approved, declined, and suspended membership states.
- Separate, revocable profile claims; one approved account per person and one person per account.
- Search names, birthplaces, communities, and occupations.
- Names, optional birth/death dates and places, tribe/community, occupation, and a short biography.
- Navigable tree based on saved connections, plus an accessible people list.
- Parent/child (biological, adoptive, step, unspecified) and partner connections.
- Recorded ancestor/descendant counts, birthplaces in a person's lineage, and a path connecting two profiles.
- Administrator approval queues, role delegation, activity history, and required authenticator verification for administrator operations.
- Cause of death in a separate, administrator-only table. No medical detail in shared stats.

Exact name matches after case/whitespace normalization are blocked during creation. An administrator can document an intentional same-name exception. Search suggestions help with variants, but no algorithm can guarantee that every spelling variation is the same person. Confirm identity with relatives, not just a name.

## Stack

React + TypeScript + Vite, Supabase Auth/PostgreSQL, and Vercel static hosting. There is no custom application server and no service-role key in the frontend. Database permissions and guarded transactional functions are the security boundary, not hidden buttons.

Umuzi is MIT licensed. Supabase offers an open-source self-hosting option; Vercel is a managed hosting service, not an open-source runtime requirement. The `dist/` frontend can be hosted elsewhere if equivalent security headers and configuration are applied. Self-hosting Supabase requires changes to the explicit URL validation/CSP and operational expertise; it is not the quickest beginner deployment.

## Run locally

Use Node 24 LTS (22.12+ for the app).

```sh
npm ci
npm test
npm run check:secrets
npm run build
npm run dev
```

Without configuration, the app shows a setup notice and collects nothing. Copy `.env.example` to `.env.local` locally, then add only the public Supabase project URL/publishable key. Do not commit `.env.local`. Never use real family data in development fixtures or screenshots.

Read [DEPLOYMENT.md](DEPLOYMENT.md) for the exact hosted setup and acceptance checks. Read [SECURITY.md](SECURITY.md) for boundaries, privacy choices, limitations, and incident response.

## Deliberate MVP boundaries

One family per installation, small trees first. No public people directory, uploads, advertising, external analytics, AI predictions, health/genetic inference, or automatic relationship inference. No notification emails beyond authentication: members use “Check approval,” and signed-in clients refresh access periodically. No bulk import/export or merge/delete UI yet. Administrators handle correction/deletion requests through a reviewed database operation and private backups. Adding people is a trusted-member privilege, not an admin-reviewed queue.

Next priorities: a reviewed duplicate-merge tool, granular living-person/minor privacy, year-only dates and place normalization, change proposals/history, and larger-tree pagination/layout. Future summaries should explain what is recorded and missing, not predict a person's future from ethnicity, tribe, or ancestry.

## Validation

`npm test` runs the actual SQL migration in PGlite (PostgreSQL in-process) with synthetic Supabase auth identities, plus graph tests. It tests authorization, claims, integrity, and rollback. It does **not** replace a deployed Supabase Auth/PostgREST/email/CAPTCHA/MFA smoke test or an independent security assessment. GitHub checks run tests, type checking/build, credential-pattern scanning, and dependency auditing.
