# Covenant — Beta Tester Guide

> Welcome. You're one of the first people testing **Covenant** — a private accounting + HRIS workspace built for service-business CEOs running with partners (bookkeepers, agencies, ministry teams). This guide walks you through every screen, from sign-up to closing your first month.

**Currently in beta. Things to know:**

- The app is fully online. Your data lives in your own private workspace and is automatically saved to the cloud as you work.
- **Payments are in test mode.** Real ₱1,000 charges don't happen yet — use the test card details I'll send you. After official launch, this becomes real.
- **Sign-in emails (magic links) are limited.** For now, password sign-in is the primary path. If you need to reset your password, contact me directly.
- **Things will probably break.** That's why you're here. When something feels broken or confusing, message me.

---

## Table of contents

1. [Getting access](#1-getting-access)
2. [First sign-in (set up your workspace)](#2-first-sign-in-set-up-your-workspace)
3. [The app at a glance](#3-the-app-at-a-glance)
4. [Set up your organization](#4-set-up-your-organization)
5. [Add businesses, partners, clients](#5-add-businesses-partners-clients)
6. [Daily workflow — attendance, devotion, services](#6-daily-workflow)
7. [Recording client payments](#7-recording-client-payments)
8. [Salaries & payroll](#8-salaries--payroll)
9. [Obligations — firstfruits, tithes, Church Project](#9-obligations)
10. [Logging remittances](#10-logging-remittances)
11. [Reports](#11-reports)
12. [Invoicing](#12-invoicing)
13. [Settings & data export](#13-settings--data-export)
14. [Troubleshooting](#14-troubleshooting)
15. [How to give feedback](#15-how-to-give-feedback)

---

## 1. Getting access

You'll receive a link from me that looks like:

```
https://covenant.asignacionalp.workers.dev
```

When you open it, you'll see the landing page with a **Buy access** button.

### Paying with a test card (during beta)

Click **Buy access**, enter your real email, and continue to PayMongo's checkout page.

Use this **test card**:

- **Card number:** `4343 4343 4343 4345`
- **Expiry:** any future date (e.g. `12/30`)
- **CVC:** any 3 digits (e.g. `123`)

No real money will be charged. PayMongo accepts the test card and treats it as a successful payment.

After paying, you'll be redirected to a **"Payment received"** page. It'll set up your access automatically (no email needed) and within a few seconds, send you to a **"Welcome to Covenant — Set up your organization"** screen.

> **Heads up:** If your browser closes the success page before redirecting, just go to the sign-in page (`/signin.html`) and click **"Already paid but never set up your account?"** at the bottom. Enter the email you paid with — you'll be sent back to the setup screen.

---

## 2. First sign-in (set up your workspace)

On the setup screen, fill in:

| Field | What to put |
|---|---|
| **Organization name** | Your business or ministry name (e.g. *"TrueVine Home Office"*) |
| **Your first name / last name** | Your real name |
| **Choose a password** | At least 8 characters. **Memorize this.** It's how you sign back in next time. |
| **Confirm password** | Same again |

Click **Create my workspace**. You'll land on the dashboard with an empty workspace.

> **Important:** Write down your password somewhere safe. Password recovery is limited during beta — if you forget it, message me.

---

## 3. The app at a glance

After signing in, you'll see:

- **Sidebar (left)**: navigation between sections grouped under Overview, People, Payroll, Finance, Reports, System.
- **Main area (right)**: whatever section you're in. Default lands on the **Dashboard**.
- **Sync indicator (bottom-left of sidebar)**: shows `✓ Synced` after every change. If you see `↻ Saving…`, your edits are being pushed to the cloud. If you see `⚠ Sync failed`, something's wrong — message me.

### Sidebar sections

| Section | What's there |
|---|---|
| **Dashboard** | Quick stats (total received, salaries, obligations owed, remitted) + verse of the day |
| **Businesses** | The revenue streams you own (each can be Service or Product) |
| **Partners** | Your team — bookkeepers, virtual assistants, etc. |
| **Attendance** | Daily time logs (Present/Absent/Half/Leave + late/undertime minutes) |
| **Devotion** | Daily devotion tracking per partner |
| **Sunday service** | Weekly Sunday service attendance |
| **Church activities** | Outreach, prayer meetings, ministries (any day) |
| **Clients** | Who your business serves |
| **Payroll runs** | Generate, review, post payroll for a period |
| **Payments** | Client payments received |
| **Invoices** | Invoices you've sent |
| **Salaries** | Salary records (auto-created from payroll runs, or entered manually) |
| **Obligations** | Auto-computed: firstfruits, tithes, Church Project, partner tithes |
| **Conviction firstfruits** | Firstfruits you give beyond what's auto-computed |
| **Remittance** | Logs of when you actually paid out obligations |
| **Reports** | All financial + people reports — sortable, drill-down, total at the bottom |
| **Users** | Add team members (Admin, Accountant) — limited in beta |
| **Resume Builder** | Career tools (separate use case) |
| **Application Tracker** | Job application pipeline |
| **Settings** | Org config, tithe rates, password, data export |

---

## 4. Set up your organization

Click **Settings** in the sidebar. Fill in:

- **Organization name** (you already set it; can edit)
- **TIN** — your Tax Identification Number (Philippines BIR)
- **Address**
- **Nature of work** — e.g. *"Accounting & Bookkeeping Services"*
- **Tithe rate** — typically `10` (10%)
- **Church Project (CP) rate** — typically `10`
- **Logo** — upload a PNG/JPG of your business logo (shows on payslips, invoices, reports)

Click **Save**. The values flow into every report and computation.

> **You can change these later.** Tithe rate especially — if you change it from 10% to 12%, click the **Recompute** button on the Obligations page and all unremitted obligations recompute under the new rate.

---

## 5. Add businesses, partners, clients

Covenant's data model has three core entities:

```
You (CEO)
  └─ Businesses (revenue streams you own)
       └─ Clients (who pays your business)
       └─ Partners (people who do the work)
```

### Businesses

Sidebar → **Businesses** → **+ Add business**.

For each business:

- **Name** — e.g. *"TrueVine Home Office"*
- **Type** — *Service* (you sell hours/skills) or *Product* (you sell goods)
- **Industry** — e.g. *"Accounting & Bookkeeping"*
- **Description** — free-form
- **Start date** — when this business began operating
- **Logo** — optional

You can have multiple businesses. Income, partners, and obligations are tracked per business.

### Partners

Sidebar → **Partners** → **+ Add partner**.

For each partner:

- **Personal info**: First/Last name, middle name, contact, DOB, gender, civil status, address
- **Government IDs** (optional but recommended for SSS/PhilHealth/Pag-Ibig deductions): SSS, TIN, PhilHealth, Pag-Ibig
- **Work info**: Role, start date, status (active/inactive)
- **Pay**:
  - **Monthly salary** + currency (e.g. ₱15,000)
  - **Hours per day** — typically 8
  - **Hourly rate** — auto-computed from salary or override
- **Tithe**: tick the box if they're enrolled in partner-tithing, set their tithe percent (typically 10)
- **Photo** — optional

Save. They appear in the Partners list and become available for assignment to clients + payroll.

### Clients

Sidebar → **Clients** → **+ Add client**.

For each client:

- **Name** — the company name
- **Business** — which of YOUR businesses serves them
- **Position** — e.g. *"Bookkeeper"*, *"Junior Accounting Assistant"*
- **Type** — Full-time / Part-time / Gig
- **Currency** — what they pay you in (PHP, USD, AUD, etc.)
- **Assigned partner** — optional; links a partner who works on this client
- **Start date**
- **Status** — Active / Inactive
- **⚜ Migrated client** checkbox — *only tick this if you started working with this client before adopting Covenant AND already gave firstfruits on past payments.* When ticked, the system skips the auto-firstfruit on this client's first Covenant-recorded payment.

Save.

---

## 6. Daily workflow

### Attendance

Sidebar → **Attendance**.

Every active partner gets a row with the current month laid out as a calendar.

**Click any day** to cycle through statuses:

- `· (none)` → empty, not logged
- `Present` → green
- `Absent` → red
- `Half-day` → orange
- `Leave` → blue
- `No work` (weekend or holiday) → gray

For Present days, you can also log:

- **Late minutes** — they came in N minutes after schedule
- **Undertime minutes** — they left N minutes before schedule
- **Overtime minutes** — they worked N minutes extra

Click on the partner row → opens an editor where you can adjust late/UT/OT for any day.

> **How it affects pay:** Late + UT minutes reduce gross pay (computed against partner's hourly rate). Absent days = no pay for that day. Half-days = half pay.

### Devotion

Sidebar → **Devotion**.

Same calendar UI. Click any day to cycle: `none → yes → no → none`.

Tracks daily Bible devotion per partner. Shows team rate, individual rate, current streak.

### Sunday service

Sidebar → **Sunday service**.

Same UI but only Sundays are clickable (other days are dimmed).

Tracks weekly Sunday church service attendance.

### Church activities

Sidebar → **Church activities**.

Same UI. Any day can be logged — outreach events, prayer meetings, ministry days.

---

## 7. Recording client payments

When a client actually pays you, log it under **Payments**.

Sidebar → **Payments** → **+ Record payment**.

- **Client** — pick from your clients list
- **Amount** — what they paid
- **Currency** — PHP, USD, AUD, etc.
- **Exchange rate** — *only required for non-PHP*. The PHP equivalent is computed `amount × rate`.
  - Example: $1000 USD at rate `61` → ₱61,000
- **Date** — when the payment landed in your bank
- **Period** — `YYYY-MM` — which monthly period this is for. Usually the same month as the date, but might differ for late-paid invoices.
- **Note** (optional) — e.g. *"Bi-weekly Salary"*, *"Q1 retainer"*

Save. Payment appears in the client's history. Obligations (firstfruit, tithe, Church Project) auto-recompute.

> **FX variance:** If the rate at payment time differs from invoice booking rate, see [Invoicing](#12-invoicing) below.

---

## 8. Salaries & payroll

Two ways to pay partners:

### Option A — Manual salary entry (simplest)

Sidebar → **Salaries** → **+ Record salary**.

- Partner, amount, currency, period, date
- Allocation to a client (optional, if you bill the cost back)
- For manual entries, **attendance deductions are NOT applied** — the amount you type is what's recorded.

Use this when:
- One-off payments (bonuses, advances, settlement payments)
- Mid-month corrections
- Non-payroll-cycle disbursements

### Option B — Payroll runs (proper)

Sidebar → **Payroll runs** → **+ New run**.

1. Pick **frequency** (monthly / semi-monthly / bi-weekly / weekly)
2. Pick **start date / end date / pay date**
3. Click **Generate** → system pulls every active partner, computes:
   - Gross pay (hourly rate × hours worked, minus late/UT/absent)
   - SSS / PhilHealth / Pag-Ibig deductions (auto, based on partner's gov-deduction config)
   - Tithe withholding (if enrolled)
   - Net pay
4. **Review** the lines. Add custom additions (bonus, holiday pay) or other deductions (loans, advances, penalties) per partner.
5. **Allocate** — split each partner's salary across the clients they worked on (e.g. 60% to Client A, 40% to Client B).
6. When ready, click **Post run**. Salaries become final, salary records are created, partner-tithe obligations are computed.

### Reversing a posted run

Posted runs can't be edited. But you can **reverse** them:

1. Open the posted run
2. Click **Reverse this run** → creates a paired reversal (preserves audit trail)
3. Generate a new run for the same period with corrections
4. Post the new run

---

## 9. Obligations

This is the core of Covenant. Sidebar → **Obligations**.

Four pools, computed automatically from your payments and salaries:

| Pool | What it is | How it's computed |
|---|---|---|
| **Firstfruits** | First income from each NEW client/business + January reset for everyone | 100% of net income for the firstfruit period |
| **Tithes** | 10% of net income (after firstfruit) | `tithe rate × net income`, per period per client |
| **Church Project** | 10% of net income (after firstfruit) | `CP rate × net income`, per period per client |
| **Partner Tithes** | Tithe withheld from each partner's pay | `partner's tithe % × their net pay`, per partner per period |

> **What's "net income"?** For each client, in each period: `payments received – (gross salary – attendance deduction) × allocation %`.
>
> The labor cost is **post-attendance**, not gross — so when a partner is late or absent, that wage savings stays inside the company and doesn't reduce client revenue.

### Conviction firstfruits

These are firstfruits you commit to give *beyond* what the system computes — out of personal conviction (a windfall, a sermon-stirred decision, a thanksgiving gift, etc.).

Sidebar → **Conviction firstfruits** → **+ Add conviction firstfruit**.

- Amount, period, date committed, optional note
- Appears as a separate line item in your Obligations pool, tracked separately from auto-computed firstfruits
- Can be remitted alongside everything else

### Recompute

If you change the tithe/CP rate, edit a past payment, or toggle a client's `migrated` flag, click the **Recompute** button on the Obligations page. The system regenerates all obligations from the underlying data while preserving balances on already-remitted ones.

---

## 10. Logging remittances

When you actually pay out your obligations to your church, sidebar → **Remittance** → **+ Log remittance**.

- **Cash amount (PHP)** — total amount you remitted
- **Date** — when you made the payment
- **Mode** — Cash / Bank transfer / GCash / Maya / Check
- **Remitted by** — who in your team handled it
- **Reference** — receipt or transaction number

### Allocating to pools

Below the basic info, allocate the cash across pools:

- Type the amount per pool (Firstfruits / Tithes / Church Project / Partner Tithes)
- The system distributes within each pool to oldest unpaid obligations first (FIFO)
- Anything in excess of unpaid obligations becomes **credit** for next time (or a one-shot bonus payment to a single obligation, your choice via the **Treat excess as credit** checkbox)

Save. Obligations balances decrease.

### Excess as credit

If you remit ₱5,000 to Tithes but the oldest unpaid tithe is only ₱4,000:

- **Box unchecked (default)**: ₱4,000 pays the oldest, ₱1,000 pays into the next-oldest
- **Box checked**: ₱4,000 pays the oldest, ₱1,000 becomes credit for next time

Use the credit option if you want a clean per-period audit trail.

---

## 11. Reports

Sidebar → **Reports**. Reports are grouped:

| Group | Reports |
|---|---|
| **Financial** | Revenue, Salary, P&L, Cashflow, Obligations, Remittance |
| **Invoices** | Outstanding receivables, Aging, Per-client history |
| **Clients** | Revenue ranking, Status, Net income per client |
| **Partners** | Attendance summary, Devotion, Earnings |
| **Payroll** | Posted-run summary, Government deductions, Other deductions |
| **Career** | Application pipeline, Source effectiveness |
| **Compliance** | Year-end summary, Monthly close pack |

Every report:
- **Sortable** — click any column header to sort (asc → desc → reset)
- **Drill-down** — click any row (or any cell on pivot reports) to expand and see the underlying records
- **Total at the bottom** — italic gold, always visible

Export everything you need to send to your accountant from **Reports → Export ministry report** (top right) — produces a JSON snapshot.

---

## 12. Invoicing

Sidebar → **Invoices** → **+ New invoice**.

For each invoice:

- **Client** — pick
- **Issue date** / **Due date**
- **Currency** + **Exchange rate** (if non-PHP)
- **Items** — add line items (description, quantity, unit price)
- **Notes / Terms** — appears on the invoice

Save as **Draft** or click **Save & send** to mark sent immediately.

### Lifecycle

Invoices go through these states:

```
Draft → Sent → Paid
            ↓
            Overdue (auto-flagged after due date)
```

You can also **Cancel** at any time.

### Recording invoice payments

When the client pays an invoice:

1. Open the invoice
2. Click **+ Record payment**
3. Enter amount, currency, exchange rate, date
4. Save

Multiple payments per invoice are allowed (partial payments).

When the total paid USD/EUR/PHP equals the invoice total, status auto-flips to **Paid**.

### FX variance

If you billed at exchange rate `61` but the client paid at rate `60`:

1. Record the payment using the **actual rate received** (`60`)
2. Invoice marks paid (USD amount matches)
3. The ₱1,000 PHP difference is a **realized FX loss**
4. Log it as an **Expense** entry with category *"FX loss"* or *"Exchange rate variance"*, amount ₱1,000, dated same as payment

Your books then correctly show: income at booking rate ₱61,000, FX loss ₱1,000, net ₱60,000 hitting the bank. Audit trail preserved on both sides.

---

## 13. Settings & data export

Sidebar → **Settings**.

### Your Data

Click **⬇ Export my data (JSON)** any time to download a portable backup of your entire workspace. Save it to Google Drive / Dropbox / a USB key. Useful for:

- Year-end archive
- Sending to your accountant
- Migrating off Covenant later (your data is yours; we never lock you in)

### Sign-in & security

Set or change your password here. Use at least 8 characters. After changing, your existing session keeps working — but next time you sign in, use the new password.

### Migration & Bulk Import

If you have prior data in spreadsheets:
- **Time entries (attendance)** — CSV import
- **Client payments** — CSV import

Download the CSV templates first, fill them in, upload. Both are non-destructive — they add to existing data.

> If you have a `covenant-backup-vN.json` file from a prior version, use the **Data Import Wizard** at `/import.html` instead. It loads everything in one shot.

### Theme

Light / Dark mode toggle in the sidebar (☾ icon next to your name).

### Animation

Toggle decorative cursor + scroll animations on or off. Off is recommended for slower computers.

---

## 14. Troubleshooting

### "I can't sign in"

1. Make sure you're typing the correct email (the one you paid with).
2. Try **Already paid but never set up your account?** on the sign-in page — works if you stopped before finishing setup.
3. Forgot password? **Email me directly** during beta — I'll reset it for you. Self-service password reset will be added when email delivery is fixed.

### "The sidebar shows ⚠ Sync failed"

Your changes haven't reached the cloud. Possible causes:
- Internet dropped briefly → click the sidebar indicator to retry
- Browser tab is rate-limited (rare) → reload the page (Ctrl+R)
- Server-side issue → message me

Your local edits are NOT lost — they stay in the page until sync succeeds.

### "I made a mistake — can I undo?"

- **Edits**: most lists let you click "Edit" to fix. Mutations are immediate; there's no global undo button.
- **Deletes**: confirmed deletes are permanent. We do warn before deleting things that have downstream effects (e.g. deleting a payment recomputes obligations).
- **Last resort**: download an export BEFORE you make a risky change. You can always cross-reference values against the JSON later.

### "The page is blank / stuck on loading"

1. Hard-refresh: **Ctrl+Shift+R** (Cmd+Shift+R on Mac)
2. Check browser console (F12 → Console) for red errors — paste them to me
3. Try in incognito/private window — rules out cached state
4. Check your internet connection

### "I see other people's data"

That should be impossible — multi-tenancy is enforced server-side. If you genuinely think it's happening, **stop and message me immediately**.

---

## 15. How to give feedback

I want to know:

| Type | What to send |
|---|---|
| **Bugs** | What you did → what you expected → what actually happened. Screenshots if visual. Browser console errors if technical. |
| **Confusing UX** | Where you got stuck or had to think too hard. Even if it "worked" eventually. |
| **Missing features** | What you wanted to do but couldn't. Be specific. |
| **Performance** | Anything that felt slow or unresponsive. Tell me what view + how many records. |
| **Praise / "this is nice"** | Also welcome. Helps me know what NOT to break. |

**Send to**: `asignacionalp@gmail.com` — subject line `[Covenant Beta]`, freeform body.

---

## What's coming after beta

The roadmap (in priority order):

- **Email delivery** — verified domain so magic-link emails reach any inbox cleanly
- **PayMongo Live mode** — real ₱1,000 charges instead of test cards
- **Custom domain** — `covenant.ph` or similar (we're on `*.workers.dev` for now)
- **Member invites** — invite Admin / Accountant teammates to your org
- **Auto-generated invoice payment links** — one-click "pay this invoice" via PayMongo
- **Real-time multi-device sync** — current sync is per-tab; future is reactive across all devices
- **More report types** — based on what you ask for

---

## Quick reference card

Print this out, stick it on your monitor:

```
SIGN IN              https://covenant.asignacionalp.workers.dev/signin.html
APP                  https://covenant.asignacionalp.workers.dev/app.html
IMPORT JSON          https://covenant.asignacionalp.workers.dev/import.html

DAILY                Attendance · Devotion · Sunday service · Church activities
WEEKLY               Payments (when client pays you)
PER PAYROLL CYCLE    Payroll runs → Generate → Review → Post
MONTHLY              Recompute Obligations → Log Remittance → Run Monthly Close report

SUPPORT              asignacionalp@gmail.com  (subject: [Covenant Beta])
```

---

Thank you for testing. Honestly. Your bug reports and "this confused me" feedback over the next few weeks shape what Covenant becomes for everyone after.

— *Al*
