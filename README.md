# Covenant

Ministry Accounting & HRIS — SaaS edition.

## Stack

- **Frontend**: Static HTML/JS (single-file app), served from Cloudflare Pages
- **Backend**: Convex (database + serverless functions + auth)
- **Auth**: Magic-link (email-based, passwordless)
- **Payments**: PayMongo (cards, GCash, Maya, GrabPay, online banking) — ₱1,000 one-time per CEO
- **Hosting**: Cloudflare Pages (deploys from this GitHub repo)
- **Email**: Resend (to be added — provider stub in place)

## Project layout

```
covenant/
├── convex/                Convex schema + queries + mutations + auth
│   ├── schema.ts
│   ├── auth.config.ts     (auth provider configuration)
│   ├── auth.ts            (magic-link logic)
│   ├── email.ts           (email provider stub — Resend hook)
│   ├── http.ts            (HTTP routes incl. PayMongo webhook)
│   ├── orgs.ts            (org / license queries)
│   └── ...one file per entity
├── public/                Cloudflare Pages deploy root
│   ├── index.html         Landing page
│   ├── app.html           The full Covenant app (was covenant.html)
│   └── signup.html        Magic-link signup/activation
├── package.json
├── tsconfig.json
├── convex.json
└── .env.local             (gitignored — Convex URL, PayMongo keys, Resend key)
```

## First-time setup (for the CEO maintaining this repo)

1. **Install Node.js** (LTS — https://nodejs.org/)
2. From this folder, run:
   ```bash
   npm install
   npx convex dev
   ```
   Convex CLI will prompt you to log in and link this folder to your existing Convex deployment (`standing-quail-556`).
3. The first `convex dev` run pushes your schema to the deployment and starts watching for changes.

## Deployment

- **Backend (Convex)**: `npx convex deploy` ships the latest schema + functions to production.
- **Frontend (Cloudflare Pages)**: connect this GitHub repo to a new Cloudflare Pages project. Set build output dir to `public/`. Pushes to `main` auto-deploy.

## Environment variables

Stored in `.env.local` (never committed). Phase 1 requires:

```
CONVEX_URL=https://standing-quail-556.convex.cloud
CONVEX_DEPLOYMENT=...                 # auto-set by `npx convex dev`
PAYMONGO_SECRET_KEY=                  # added in Phase 1.3
PAYMONGO_WEBHOOK_SECRET=              # added in Phase 1.3
RESEND_API_KEY=                       # added when email goes live
APP_URL=https://covenant.pages.dev    # public URL — used in magic links
```

## Scope notes

- Migration utilities `recomputeAllObligations()` and `backfillSalaryOtherDeductions()` are removed in this version. They existed to fix legacy in-memory data; new tenants don't have that data. The everyday "Recompute" button on the Obligations page (which calls `computeAll()`) remains.
- All entities are scoped by `orgId` for multi-tenancy. One paying CEO = one org.
