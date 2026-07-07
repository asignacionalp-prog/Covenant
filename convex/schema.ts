/**
 * Covenant — Convex schema.
 *
 * Every business-data table is scoped by `orgId` (one paying CEO = one org).
 * Field names mirror the in-memory `S` object from covenant.html so the
 * existing render functions can be ported verbatim once we're on Convex.
 *
 * Naming convention: legacy short field names (fn, ln, am, cu, pe, dt, etc.)
 * are preserved for parity with the offline app. New fields added for the
 * SaaS layer (orgId, createdAt, etc.) use full descriptive names.
 *
 * Auth: Convex Auth provides its own `users` table — see auth.config.ts.
 * The legacy `users` array (CEO/admin/accountant accounts in the standalone
 * app) becomes the `members` table here, joining auth users to orgs with a
 * role.
 */
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // ─────────────────────────────────────────────────────────────
  // AUTH (custom magic-link)
  //
  // Phase 1.2b uses a simple home-grown auth instead of
  // @convex-dev/auth — the app is vanilla HTML+JS and the React-first
  // ergonomics of @convex-dev/auth would force a build step we don't
  // need. The mechanics are identical: short-lived magic-link tokens
  // grant longer-lived session tokens stored in localStorage.
  // ─────────────────────────────────────────────────────────────

  users: defineTable({
    email: v.string(),
    createdAt: v.number(),
    lastSignInAt: v.optional(v.number()),
    /**
     * PBKDF2 hash of the user's password, stored as
     * `pbkdf2$<iterations>$<saltB64>$<hashB64>`. Optional because:
     *  (a) magic-link-only users created before password support
     *      have no hash yet — they still sign in via magic link,
     *  (b) the bootstrap flow may be aborted before the password
     *      step on a slow connection.
     */
    passwordHash: v.optional(v.string()),
    passwordSetAt: v.optional(v.number()),
  }).index("by_email", ["email"]),

  /**
   * Long-lived session tokens (30 days). The frontend stores the
   * sessionToken in localStorage and passes it on every query/mutation
   * call as `sessionToken` arg. `requireSession()` validates.
   */
  sessions: defineTable({
    userId: v.id("users"),
    sessionToken: v.string(),
    expiresAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_token", ["sessionToken"])
    .index("by_user", ["userId"]),

  /**
   * Short-lived magic-link tokens (15 minutes). Single use — once
   * consumed, `consumedAt` is stamped and the row is no longer
   * accepted. Rows are not deleted on consume so the audit trail
   * survives.
   */
  authTokens: defineTable({
    email: v.string(),
    token: v.string(),
    expiresAt: v.number(),
    consumedAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_token", ["token"]),

  // ─────────────────────────────────────────────────────────────
  // ORGS + LICENSES + MEMBERSHIP
  // ─────────────────────────────────────────────────────────────

  /**
   * One row per paying CEO. Holds the global config (company name, TIN,
   * tithe rate, etc.) that the standalone app stored in `S.cfg`.
   */
  orgs: defineTable({
    name: v.string(),
    tin: v.optional(v.string()),
    addr: v.optional(v.string()),
    natureOfWork: v.optional(v.string()),
    titheRate: v.number(),         // S.cfg.tithe — default 10
    cpRate: v.number(),            // S.cfg.cp — Church Project, default 10
    logo: v.optional(v.string()),  // base64 data URL — same as standalone
    createdAt: v.number(),         // ms epoch
    licenseId: v.optional(v.id("licenses")),
  }),

  /**
   * One row per ₱1,000 purchase. Created by the PayMongo webhook BEFORE
   * the buyer signs up. The signup token is the bridge: buyer clicks the
   * email link, presents the token, and we bind their auth user to a
   * fresh org via this license.
   */
  licenses: defineTable({
    email: v.string(),               // email captured at PayMongo checkout
    paymongoPaymentId: v.string(),
    amount: v.number(),              // ₱1,000 in centavos = 100000
    currency: v.string(),            // "PHP"
    signupToken: v.string(),         // random — sent via magic link email
    tokenExpiresAt: v.number(),      // ms epoch
    status: v.union(
      v.literal("paid"),
      v.literal("activated"),
      v.literal("expired"),
      v.literal("refunded"),
    ),
    activatedAt: v.optional(v.number()),
    activatedOrgId: v.optional(v.id("orgs")),
    activatedUserId: v.optional(v.id("users")),
    createdAt: v.number(),
  })
    .index("by_signup_token", ["signupToken"])
    .index("by_paymongo_payment", ["paymongoPaymentId"])
    .index("by_email", ["email"]),

  /**
   * Maps an authenticated user to an org with a role. Replaces the legacy
   * `S.users` array. Populated at signup (CEO), then by /users page invites.
   */
  members: defineTable({
    orgId: v.id("orgs"),
    /**
     * Optional because a CEO can invite a teammate by email before
     * that person ever signs in. When the invitee uses their magic
     * link, `consumeMagicLink` links the new user row to the existing
     * member row by matching email.
     */
    userId: v.optional(v.id("users")),
    role: v.union(
      v.literal("ceo"),
      v.literal("admin"),
      v.literal("accountant"),
    ),
    fn: v.string(),
    ln: v.string(),
    em: v.string(),
    invitedAt: v.optional(v.number()),
    joinedAt: v.optional(v.number()),
    status: v.union(v.literal("active"), v.literal("inactive")),
  })
    .index("by_org", ["orgId"])
    .index("by_user", ["userId"])
    .index("by_org_email", ["orgId", "em"]),

  // ─────────────────────────────────────────────────────────────
  // CORE ENTITIES — direct port of S.* from covenant.html
  // ─────────────────────────────────────────────────────────────

  /** Legacy: S.partners */
  partners: defineTable({
    orgId: v.id("orgs"),
    legacyId: v.optional(v.number()),     // for cross-ref during JSON import
    bid: v.optional(v.number()),          // legacy business id
    businessId: v.optional(v.id("businesses")),
    fn: v.string(),
    ln: v.string(),
    mn: v.optional(v.string()),
    ex: v.optional(v.string()),
    ct: v.optional(v.string()),
    dob: v.optional(v.string()),
    em: v.optional(v.string()),
    gn: v.optional(v.string()),
    cs: v.optional(v.string()),
    pob: v.optional(v.string()),
    ad: v.optional(v.string()),
    sss: v.optional(v.string()),
    tin: v.optional(v.string()),
    pg: v.optional(v.string()),
    ph: v.optional(v.string()),
    ro: v.optional(v.string()),
    sd: v.optional(v.string()),
    st: v.union(v.literal("active"), v.literal("inactive")),
    sa: v.optional(v.number()),           // monthly salary
    cu: v.optional(v.string()),
    eh: v.optional(v.number()),           // expected hours / day
    hr: v.optional(v.number()),           // hourly rate
    tc: v.optional(v.boolean()),          // tithe checkbox
    tp: v.optional(v.number()),           // tithe percent
    gd: v.optional(v.object({
      sss: v.optional(v.number()),
      ph: v.optional(v.number()),
      pg: v.optional(v.number()),
    })),
    photo: v.optional(v.string()),
    notes: v.optional(v.string()),
    /** YYYY-MM-DD when the partner was deactivated. Recorded so we
     *  can filter dropdowns by date (don't show a partner deactivated
     *  before the new record's date). Optional — pre-feature partners
     *  may have `st: "inactive"` with no recorded date. */
    deactivatedAt: v.optional(v.string()),
    /** Free-text reason a partner was deactivated. For HR/audit. */
    deactivationReason: v.optional(v.string()),
    /**
     * Forward-looking schedule of rate changes. Distinct from the
     * legacy in-memory `rateHistory` audit log (which records the
     * timestamp of every partner-form save). Each entry is a partial
     * snapshot — only fields the CEO changed on `effectiveFrom` need
     * to be filled in. For any target date, the effective rate is
     * derived by starting with the baseline (top-level p.sa/hr/eh/tp/gd)
     * and applying every schedule entry whose effectiveFrom <= target,
     * in ascending order.
     *
     * hr and eh prorate day-by-day inside payroll. sa is stored for
     * audit/display. tp and gd use whichever is effective at the END
     * of the payroll period (statutory contributions are inherently
     * monthly-frequency, so per-day proration would be misleading).
     */
    rateSchedule: v.optional(v.array(v.object({
      effectiveFrom: v.string(),          // YYYY-MM-DD
      sa: v.optional(v.number()),
      hr: v.optional(v.number()),
      eh: v.optional(v.number()),
      tp: v.optional(v.number()),
      gd: v.optional(v.object({
        sss: v.optional(v.number()),
        ph: v.optional(v.number()),
        pg: v.optional(v.number()),
      })),
      note: v.optional(v.string()),
    }))),
  })
    .index("by_org", ["orgId"])
    .index("by_org_legacyId", ["orgId", "legacyId"]),

  /** Legacy: S.businesses */
  businesses: defineTable({
    orgId: v.id("orgs"),
    legacyId: v.optional(v.number()),
    nm: v.string(),
    type: v.optional(v.string()),         // "service" | "product"
    ownerId: v.optional(v.number()),
    industry: v.optional(v.string()),
    desc: v.optional(v.string()),
    sd: v.optional(v.string()),
    st: v.union(v.literal("active"), v.literal("inactive")),
    logo: v.optional(v.string()),
  })
    .index("by_org", ["orgId"])
    .index("by_org_legacyId", ["orgId", "legacyId"]),

  /** Legacy: S.clients */
  clients: defineTable({
    orgId: v.id("orgs"),
    legacyId: v.optional(v.number()),
    bid: v.optional(v.number()),
    businessId: v.optional(v.id("businesses")),
    nm: v.string(),
    ty: v.optional(v.string()),           // 'full-time' | 'part-time' | 'gig'
    cu: v.optional(v.string()),
    pid: v.optional(v.union(v.number(), v.null())),  // assigned partner legacy id
    partnerId: v.optional(v.id("partners")),
    st: v.union(v.literal("active"), v.literal("inactive")),
    sd: v.optional(v.string()),
    pos: v.optional(v.string()),
    resp: v.optional(v.array(v.string())),
    creds: v.optional(v.array(v.any())),
    migrated: v.optional(v.boolean()),
  })
    .index("by_org", ["orgId"])
    .index("by_org_legacyId", ["orgId", "legacyId"]),

  /** Legacy: S.payments */
  payments: defineTable({
    orgId: v.id("orgs"),
    legacyId: v.optional(v.number()),
    ci: v.optional(v.number()),           // legacy client id
    clientId: v.optional(v.id("clients")),
    am: v.number(),
    cu: v.string(),
    rt: v.optional(v.number()),           // exchange rate to PHP
    dt: v.optional(v.string()),           // YYYY-MM-DD
    pe: v.optional(v.string()),           // YYYY-MM
    source: v.optional(v.string()),
    note: v.optional(v.string()),
    invoiceId: v.optional(v.union(v.number(), v.id("invoices"))),
    /**
     * "Increase" portion of this payment — the CEO's declared raise
     * amount, in the payment's own currency (same units as `am`).
     * Theologically: firstfruit is the first of any increase, so
     * when a client's payment goes up, that delta is tracked as a
     * firstfruit obligation on top of the normal tithe/church on
     * the baseline. See computeAll for how this is applied.
     * Optional (defaults to 0) so pre-feature payments still validate.
     */
    inc: v.optional(v.number()),
  })
    .index("by_org", ["orgId"])
    .index("by_org_period", ["orgId", "pe"])
    .index("by_org_client", ["orgId", "clientId"])
    .index("by_org_legacyId", ["orgId", "legacyId"]),

  /** Legacy: S.salaries */
  salaries: defineTable({
    orgId: v.id("orgs"),
    legacyId: v.optional(v.number()),
    pid: v.optional(v.number()),
    partnerId: v.optional(v.id("partners")),
    ci: v.optional(v.number()),
    clientId: v.optional(v.id("clients")),
    pc: v.optional(v.number()),           // allocation percent (0-100)
    am: v.number(),
    cu: v.string(),
    rt: v.optional(v.number()),
    dt: v.optional(v.string()),
    pe: v.optional(v.string()),
    ad: v.optional(v.number()),           // attendance deduction
    td: v.optional(v.number()),           // tithe withheld
    od: v.optional(v.number()),           // other deductions
    source: v.optional(v.string()),       // "manual" | "payroll-run-N"
  })
    .index("by_org", ["orgId"])
    .index("by_org_period", ["orgId", "pe"])
    .index("by_org_partner", ["orgId", "partnerId"])
    .index("by_org_client", ["orgId", "clientId"])
    .index("by_org_legacyId", ["orgId", "legacyId"]),

  /**
   * Legacy: S.att (object keyed by `partnerId:date`).
   * Flattened into a row-per-day-per-partner. Holds devotion (`dv`),
   * Sunday service (`ss`), and church activities (`ca`) flags.
   */
  attendance: defineTable({
    orgId: v.id("orgs"),
    partnerLegacyId: v.optional(v.number()),
    partnerId: v.optional(v.id("partners")),
    date: v.string(),                     // YYYY-MM-DD
    st: v.optional(v.string()),           // 'present' | 'absent' | 'half' | 'leave' | 'nowork'
    lm: v.optional(v.number()),           // late minutes
    um: v.optional(v.number()),           // undertime minutes
    om: v.optional(v.number()),           // overtime minutes
    notes: v.optional(v.string()),
    dv: v.optional(v.string()),           // devotion: 'yes' | 'no'
    ss: v.optional(v.string()),           // sunday service: 'yes' | 'no'
    ca: v.optional(v.string()),           // church activity: 'yes' | 'no'
  })
    .index("by_org_partner_date", ["orgId", "partnerId", "date"])
    .index("by_org_date", ["orgId", "date"]),

  /** Legacy: S.obls */
  obligations: defineTable({
    orgId: v.id("orgs"),
    legacyId: v.optional(v.number()),
    ty: v.string(),                       // 'firstfruit' | 'tithe' | 'church' | 'partner-tithe'
    lb: v.string(),
    pe: v.optional(v.string()),
    ci: v.optional(v.number()),
    clientId: v.optional(v.id("clients")),
    bid: v.optional(v.number()),
    businessId: v.optional(v.id("businesses")),
    ptnId: v.optional(v.number()),
    partnerId: v.optional(v.id("partners")),
    tot: v.number(),                      // total due
    bal: v.number(),                      // balance remaining
    key: v.optional(v.string()),          // dedupe key (e.g., "ti-1-2026-04")
    archived: v.optional(v.boolean()),
    conviction: v.optional(v.boolean()),
    logs: v.optional(v.array(v.object({   // remittance log allocations against this obligation
      logId: v.optional(v.number()),
      am: v.number(),
      dt: v.optional(v.string()),
    }))),
  })
    .index("by_org", ["orgId"])
    .index("by_org_period", ["orgId", "pe"])
    .index("by_org_key", ["orgId", "key"])
    .index("by_org_legacyId", ["orgId", "legacyId"]),

  /** Legacy: S.logs (remittance log) */
  remittanceLogs: defineTable({
    orgId: v.id("orgs"),
    legacyId: v.optional(v.number()),
    dt: v.string(),                       // YYYY-MM-DD
    am: v.number(),
    mo: v.optional(v.string()),           // mode: Cash, GCash, BankTransfer, etc.
    by: v.optional(v.string()),
    rf: v.optional(v.string()),           // reference no.
    al: v.optional(v.array(v.object({     // per-obligation allocation
      oi: v.number(),                     // obligation legacy id
      am: v.number(),
    }))),
    poolAl: v.optional(v.array(v.object({ // pool-level allocation summary
      ty: v.string(),
      label: v.optional(v.string()),
      am: v.number(),
      excess: v.optional(v.number()),
    }))),
    creditUsed: v.optional(v.number()),
    creditEarned: v.optional(v.number()),
  })
    .index("by_org", ["orgId"])
    .index("by_org_date", ["orgId", "dt"])
    .index("by_org_legacyId", ["orgId", "legacyId"]),

  /** Legacy: S.runs (payroll runs) */
  payrollRuns: defineTable({
    orgId: v.id("orgs"),
    legacyId: v.optional(v.number()),
    freq: v.string(),                     // 'monthly' | 'semi-monthly' | 'bi-weekly' | 'weekly'
    label: v.optional(v.string()),
    start: v.optional(v.string()),
    end: v.optional(v.string()),
    paydate: v.optional(v.string()),
    notes: v.optional(v.string()),
    status: v.string(),                   // 'draft' | 'review' | 'posted'
    lines: v.array(v.any()),              // per-partner line items — shape preserved as-is
  })
    .index("by_org", ["orgId"])
    .index("by_org_status", ["orgId", "status"])
    .index("by_org_legacyId", ["orgId", "legacyId"]),

  /** Legacy: S.invoices */
  invoices: defineTable({
    orgId: v.id("orgs"),
    legacyId: v.optional(v.number()),
    num: v.string(),
    ci: v.optional(v.number()),
    clientId: v.optional(v.id("clients")),
    bid: v.optional(v.number()),
    businessId: v.optional(v.id("businesses")),
    issueDt: v.optional(v.string()),
    dueDt: v.optional(v.string()),
    paidDt: v.optional(v.string()),
    cu: v.string(),
    rt: v.optional(v.number()),
    items: v.optional(v.array(v.any())),
    notes: v.optional(v.string()),
    terms: v.optional(v.string()),
    status: v.string(),                   // 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled'
    payments: v.optional(v.array(v.any())),
  })
    .index("by_org", ["orgId"])
    .index("by_org_status", ["orgId", "status"])
    .index("by_org_client", ["orgId", "clientId"])
    .index("by_org_legacyId", ["orgId", "legacyId"]),

  /** Legacy: S.credits + S.clientCredits — kept as separate tables */
  credits: defineTable({
    orgId: v.id("orgs"),
    legacyId: v.optional(v.number()),
    ty: v.string(),                       // 'tithe' | 'church' | 'firstfruit' | 'partner-tithe'
    am: v.number(),
    pe: v.optional(v.string()),
    note: v.optional(v.string()),
    used: v.optional(v.boolean()),
  })
    .index("by_org", ["orgId"])
    .index("by_org_legacyId", ["orgId", "legacyId"]),

  clientCredits: defineTable({
    orgId: v.id("orgs"),
    legacyId: v.optional(v.number()),
    ci: v.optional(v.number()),
    clientId: v.optional(v.id("clients")),
    am: v.number(),
    cu: v.optional(v.string()),
    pe: v.optional(v.string()),
    note: v.optional(v.string()),
    used: v.optional(v.boolean()),
  })
    .index("by_org", ["orgId"])
    .index("by_org_legacyId", ["orgId", "legacyId"]),

  /** Legacy: S.convictionFirstfruits */
  convictionFirstfruits: defineTable({
    orgId: v.id("orgs"),
    legacyId: v.optional(v.number()),
    amount: v.number(),
    pe: v.string(),
    dt: v.string(),
    note: v.optional(v.string()),
    loggedAt: v.optional(v.string()),
  })
    .index("by_org", ["orgId"])
    .index("by_org_period", ["orgId", "pe"])
    .index("by_org_legacyId", ["orgId", "legacyId"]),

  /** Legacy: S.sales (product-business sales) */
  sales: defineTable({
    orgId: v.id("orgs"),
    legacyId: v.optional(v.number()),
    bid: v.optional(v.number()),
    businessId: v.optional(v.id("businesses")),
    am: v.number(),
    cu: v.string(),
    rt: v.optional(v.number()),
    dt: v.optional(v.string()),
    pe: v.optional(v.string()),
    note: v.optional(v.string()),
  })
    .index("by_org", ["orgId"])
    .index("by_org_period", ["orgId", "pe"])
    .index("by_org_legacyId", ["orgId", "legacyId"]),

  /** Legacy: S.expenses */
  expenses: defineTable({
    orgId: v.id("orgs"),
    legacyId: v.optional(v.number()),
    bid: v.optional(v.number()),
    businessId: v.optional(v.id("businesses")),
    am: v.number(),
    cu: v.string(),
    rt: v.optional(v.number()),
    dt: v.optional(v.string()),
    pe: v.optional(v.string()),
    cat: v.optional(v.string()),
    note: v.optional(v.string()),
  })
    .index("by_org", ["orgId"])
    .index("by_org_period", ["orgId", "pe"])
    .index("by_org_legacyId", ["orgId", "legacyId"]),

  /** Legacy: S.apps (job applications — Career section) */
  applications: defineTable({
    orgId: v.id("orgs"),
    legacyId: v.optional(v.number()),
    company: v.optional(v.string()),
    position: v.optional(v.string()),
    dateApplied: v.optional(v.string()),
    status: v.optional(v.string()),
    industry: v.optional(v.string()),
    source: v.optional(v.string()),
    workSetup: v.optional(v.string()),
    location: v.optional(v.string()),
    salary: v.optional(v.string()),
    url: v.optional(v.string()),
    contactName: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    contactPhone: v.optional(v.string()),
    nextAction: v.optional(v.string()),
    nextActionDue: v.optional(v.string()),
    jd: v.optional(v.string()),
    notes: v.optional(v.string()),
    rejectionReason: v.optional(v.string()),
    interviews: v.optional(v.array(v.any())),
    lastUpdated: v.optional(v.string()),
  })
    .index("by_org", ["orgId"])
    .index("by_org_status", ["orgId", "status"])
    .index("by_org_legacyId", ["orgId", "legacyId"]),

  // ─────────────────────────────────────────────────────────────
  // AUDIT + SUPPORT
  // ─────────────────────────────────────────────────────────────

  /** Append-only event log (audit trail) — populated as we port mutations. */
  events: defineTable({
    orgId: v.id("orgs"),
    userId: v.optional(v.id("users")),
    kind: v.string(),                     // 'payment.create' | 'salary.update' | …
    target: v.optional(v.string()),
    payload: v.optional(v.any()),
    ts: v.number(),
  })
    .index("by_org_ts", ["orgId", "ts"]),

  /** One-shot import jobs — tracks JSON imports for first-time onboarding. */
  importJobs: defineTable({
    orgId: v.id("orgs"),
    userId: v.id("users"),
    schema: v.string(),                   // "covenant-backup-v1"
    counts: v.optional(v.object({
      partners: v.number(),
      businesses: v.number(),
      clients: v.number(),
      payments: v.number(),
      salaries: v.number(),
      attendance: v.number(),
      obligations: v.number(),
      remittanceLogs: v.number(),
      payrollRuns: v.number(),
      invoices: v.number(),
      sales: v.number(),
      expenses: v.number(),
      convictionFirstfruits: v.number(),
      applications: v.number(),
    })),
    status: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("done"),
      v.literal("failed"),
    ),
    error: v.optional(v.string()),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
  }).index("by_org", ["orgId"]),
});
