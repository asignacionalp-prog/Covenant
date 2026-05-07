/**
 * JSON import — bulk-loads a covenant-backup-v1 JSON into the
 * caller's org. The frontend (public/import.html) parses the file,
 * splits it by entity, and calls these mutations in dependency
 * order so foreign keys can be resolved.
 *
 * Strategy:
 *   - Each entity table has a `legacyId` field + `by_org_legacyId`
 *     index. We store the original integer id at insert time, then
 *     look it up later when a child entity references it.
 *   - All mutations accept an `items` array typed as `v.any()` —
 *     this is intentional. The JSON shape evolves over time and
 *     we'd rather accept unknown fields silently than reject them.
 *   - Each mutation re-validates the session and returns
 *     `{ count }` for progress reporting.
 */
import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { requireSession } from "./auth";
import type { MutationCtx } from "./_generated/server";

// ─── helpers ──────────────────────────────────────────────────

async function requireOrg(
  ctx: MutationCtx,
  sessionToken: string,
): Promise<{ user: Doc<"users">; orgId: Id<"orgs"> }> {
  const { user } = await requireSession(ctx, sessionToken);
  const member = await ctx.db
    .query("members")
    .withIndex("by_user", (q) => q.eq("userId", user._id))
    .first();
  if (!member) {
    throw new Error("You're not part of any org yet. Sign up first.");
  }
  return { user, orgId: member.orgId };
}

type LookupTable = "businesses" | "partners" | "clients" | "obligations";

async function lookupLegacy<T extends LookupTable>(
  ctx: MutationCtx,
  orgId: Id<"orgs">,
  table: T,
  legacyId: number | null | undefined,
): Promise<Id<T> | undefined> {
  if (legacyId == null) return undefined;
  const row = await ctx.db
    .query(table)
    .withIndex("by_org_legacyId", (q) =>
      q.eq("orgId", orgId).eq("legacyId", legacyId),
    )
    .first();
  return row?._id as Id<T> | undefined;
}

const cleanStatus = (s: unknown): "active" | "inactive" =>
  s === "inactive" ? "inactive" : "active";

// ─── 1. ORG CONFIG ────────────────────────────────────────────

export const importOrgConfig = mutation({
  args: {
    sessionToken: v.string(),
    cfg: v.object({
      name: v.optional(v.string()),
      tin: v.optional(v.string()),
      addr: v.optional(v.string()),
      tithe: v.optional(v.number()),
      cp: v.optional(v.number()),
      natureOfWork: v.optional(v.string()),
      logo: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx, args.sessionToken);
    const patch: Record<string, unknown> = {};
    const c = args.cfg;
    if (c.name !== undefined && c.name !== "") patch.name = c.name;
    if (c.tin !== undefined) patch.tin = c.tin;
    if (c.addr !== undefined) patch.addr = c.addr;
    if (c.tithe !== undefined) patch.titheRate = c.tithe;
    if (c.cp !== undefined) patch.cpRate = c.cp;
    if (c.natureOfWork !== undefined) patch.natureOfWork = c.natureOfWork;
    if (c.logo !== undefined) patch.logo = c.logo;
    await ctx.db.patch(orgId, patch);
    return { ok: true };
  },
});

// ─── 2. BUSINESSES ────────────────────────────────────────────

export const importBusinesses = mutation({
  args: { sessionToken: v.string(), items: v.array(v.any()) },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx, args.sessionToken);
    let count = 0;
    for (let i = 0; i < args.items.length; i++) {
      const b = args.items[i];
      await ctx.db.insert("businesses", {
        orgId,
        legacyId: typeof b.id === "number" ? b.id : i + 1,
        nm: b.nm ?? "Untitled business",
        type: b.type,
        ownerId: typeof b.ownerId === "number" ? b.ownerId : undefined,
        industry: b.industry,
        desc: b.desc,
        sd: b.sd,
        st: cleanStatus(b.st),
        logo: b.logo,
      });
      count++;
    }
    return { count };
  },
});

// ─── 3. PARTNERS ──────────────────────────────────────────────

export const importPartners = mutation({
  args: { sessionToken: v.string(), items: v.array(v.any()) },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx, args.sessionToken);
    let count = 0;
    for (let i = 0; i < args.items.length; i++) {
      const p = args.items[i];
      const businessId = await lookupLegacy(ctx, orgId, "businesses", p.bid);
      await ctx.db.insert("partners", {
        orgId,
        legacyId: typeof p.id === "number" ? p.id : i + 1,
        bid: typeof p.bid === "number" ? p.bid : undefined,
        businessId,
        fn: p.fn ?? "—",
        ln: p.ln ?? "—",
        mn: p.mn,
        ex: p.ex,
        ct: p.ct,
        dob: p.dob,
        em: p.em,
        gn: p.gn,
        cs: p.cs,
        pob: p.pob,
        ad: p.ad,
        sss: p.sss,
        tin: p.tin,
        pg: p.pg,
        ph: p.ph,
        ro: p.ro,
        sd: p.sd,
        st: cleanStatus(p.st),
        sa: typeof p.sa === "number" ? p.sa : undefined,
        cu: p.cu,
        eh: typeof p.eh === "number" ? p.eh : undefined,
        hr: typeof p.hr === "number" ? p.hr : undefined,
        tc: typeof p.tc === "boolean" ? p.tc : undefined,
        tp: typeof p.tp === "number" ? p.tp : undefined,
        gd: p.gd
          ? {
              sss: typeof p.gd.sss === "number" ? p.gd.sss : undefined,
              ph: typeof p.gd.ph === "number" ? p.gd.ph : undefined,
              pg: typeof p.gd.pg === "number" ? p.gd.pg : undefined,
            }
          : undefined,
        photo: p.photo,
        notes: p.notes,
      });
      count++;
    }
    return { count };
  },
});

// ─── 4. CLIENTS ───────────────────────────────────────────────

export const importClients = mutation({
  args: { sessionToken: v.string(), items: v.array(v.any()) },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx, args.sessionToken);
    let count = 0;
    for (let i = 0; i < args.items.length; i++) {
      const c = args.items[i];
      const businessId = await lookupLegacy(ctx, orgId, "businesses", c.bid);
      const partnerId =
        typeof c.pid === "number"
          ? await lookupLegacy(ctx, orgId, "partners", c.pid)
          : undefined;
      await ctx.db.insert("clients", {
        orgId,
        legacyId: typeof c.id === "number" ? c.id : i + 1,
        bid: typeof c.bid === "number" ? c.bid : undefined,
        businessId,
        nm: c.nm ?? "Untitled client",
        ty: c.ty,
        cu: c.cu,
        pid: c.pid === null || typeof c.pid === "number" ? c.pid : undefined,
        partnerId,
        st: cleanStatus(c.st),
        sd: c.sd,
        pos: c.pos,
        resp: Array.isArray(c.resp) ? c.resp : undefined,
        creds: Array.isArray(c.creds) ? c.creds : undefined,
        migrated: typeof c.migrated === "boolean" ? c.migrated : undefined,
      });
      count++;
    }
    return { count };
  },
});

// ─── 5. PAYMENTS ──────────────────────────────────────────────

export const importPayments = mutation({
  args: { sessionToken: v.string(), items: v.array(v.any()) },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx, args.sessionToken);
    let count = 0;
    for (const p of args.items) {
      const clientId = await lookupLegacy(ctx, orgId, "clients", p.ci);
      await ctx.db.insert("payments", {
        orgId,
        legacyId: typeof p.id === "number" ? p.id : undefined,
        ci: typeof p.ci === "number" ? p.ci : undefined,
        clientId,
        am: typeof p.am === "number" ? p.am : 0,
        cu: p.cu ?? "PHP",
        rt: typeof p.rt === "number" ? p.rt : undefined,
        dt: p.dt,
        pe: p.pe,
        source: p.source,
        note: p.note,
        invoiceId: typeof p.invoiceId === "number" ? p.invoiceId : undefined,
      });
      count++;
    }
    return { count };
  },
});

// ─── 6. SALARIES ──────────────────────────────────────────────

export const importSalaries = mutation({
  args: { sessionToken: v.string(), items: v.array(v.any()) },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx, args.sessionToken);
    let count = 0;
    for (const s of args.items) {
      const partnerId = await lookupLegacy(ctx, orgId, "partners", s.pid);
      const clientId = await lookupLegacy(ctx, orgId, "clients", s.ci);
      await ctx.db.insert("salaries", {
        orgId,
        legacyId: typeof s.id === "number" ? s.id : undefined,
        pid: typeof s.pid === "number" ? s.pid : undefined,
        partnerId,
        ci: typeof s.ci === "number" ? s.ci : undefined,
        clientId,
        pc: typeof s.pc === "number" ? s.pc : undefined,
        am: typeof s.am === "number" ? s.am : 0,
        cu: s.cu ?? "PHP",
        rt: typeof s.rt === "number" ? s.rt : undefined,
        dt: s.dt,
        pe: s.pe,
        ad: typeof s.ad === "number" ? s.ad : undefined,
        td: typeof s.td === "number" ? s.td : undefined,
        od: typeof s.od === "number" ? s.od : undefined,
        source: s.source,
      });
      count++;
    }
    return { count };
  },
});

// ─── 7. ATTENDANCE ────────────────────────────────────────────

/**
 * Frontend converts the keyed `att` object into
 * `[{partnerId, date, ...rest}, ...]` before sending. We chunk
 * on the frontend if the array gets very large.
 */
export const importAttendance = mutation({
  args: { sessionToken: v.string(), items: v.array(v.any()) },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx, args.sessionToken);
    let count = 0;
    for (const a of args.items) {
      const partnerId = await lookupLegacy(ctx, orgId, "partners", a.partnerId);
      await ctx.db.insert("attendance", {
        orgId,
        partnerLegacyId:
          typeof a.partnerId === "number" ? a.partnerId : undefined,
        partnerId,
        date: String(a.date),
        st: a.st,
        lm: typeof a.lm === "number" ? a.lm : undefined,
        um: typeof a.um === "number" ? a.um : undefined,
        om: typeof a.om === "number" ? a.om : undefined,
        notes: a.notes,
        dv: a.dv,
        ss: a.ss,
        ca: a.ca,
      });
      count++;
    }
    return { count };
  },
});

// ─── 8. OBLIGATIONS ───────────────────────────────────────────

export const importObligations = mutation({
  args: { sessionToken: v.string(), items: v.array(v.any()) },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx, args.sessionToken);
    let count = 0;
    for (const o of args.items) {
      const clientId = await lookupLegacy(ctx, orgId, "clients", o.ci);
      const businessId = await lookupLegacy(ctx, orgId, "businesses", o.bid);
      const partnerId = await lookupLegacy(ctx, orgId, "partners", o.ptnId);
      await ctx.db.insert("obligations", {
        orgId,
        legacyId: typeof o.id === "number" ? o.id : undefined,
        ty: o.ty ?? "tithe",
        lb: o.lb ?? "",
        pe: o.pe,
        ci: typeof o.ci === "number" ? o.ci : undefined,
        clientId,
        bid: typeof o.bid === "number" ? o.bid : undefined,
        businessId,
        ptnId: typeof o.ptnId === "number" ? o.ptnId : undefined,
        partnerId,
        tot: typeof o.tot === "number" ? o.tot : 0,
        bal: typeof o.bal === "number" ? o.bal : 0,
        key: o.key,
        archived: typeof o.archived === "boolean" ? o.archived : undefined,
        conviction:
          typeof o.conviction === "boolean" ? o.conviction : undefined,
        logs: Array.isArray(o.logs)
          ? o.logs.map((l: any) => ({
              logId: typeof l.logId === "number" ? l.logId : undefined,
              am: typeof l.am === "number" ? l.am : 0,
              dt: l.dt,
            }))
          : undefined,
      });
      count++;
    }
    return { count };
  },
});

// ─── 9. REMITTANCE LOGS ───────────────────────────────────────

export const importRemittanceLogs = mutation({
  args: { sessionToken: v.string(), items: v.array(v.any()) },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx, args.sessionToken);
    let count = 0;
    for (const l of args.items) {
      await ctx.db.insert("remittanceLogs", {
        orgId,
        legacyId: typeof l.id === "number" ? l.id : undefined,
        dt: l.dt ?? "",
        am: typeof l.am === "number" ? l.am : 0,
        mo: l.mo,
        by: l.by,
        rf: l.rf,
        al: Array.isArray(l.al)
          ? l.al.map((a: any) => ({
              oi: typeof a.oi === "number" ? a.oi : 0,
              am: typeof a.am === "number" ? a.am : 0,
            }))
          : undefined,
        poolAl: Array.isArray(l.poolAl)
          ? l.poolAl.map((p: any) => ({
              ty: String(p.ty ?? ""),
              label: p.label,
              am: typeof p.am === "number" ? p.am : 0,
              excess: typeof p.excess === "number" ? p.excess : undefined,
            }))
          : undefined,
        creditUsed:
          typeof l.creditUsed === "number" ? l.creditUsed : undefined,
        creditEarned:
          typeof l.creditEarned === "number" ? l.creditEarned : undefined,
      });
      count++;
    }
    return { count };
  },
});

// ─── 10. PAYROLL RUNS ────────────────────────────────────────

export const importPayrollRuns = mutation({
  args: { sessionToken: v.string(), items: v.array(v.any()) },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx, args.sessionToken);
    let count = 0;
    for (const r of args.items) {
      await ctx.db.insert("payrollRuns", {
        orgId,
        legacyId: typeof r.id === "number" ? r.id : undefined,
        freq: r.freq ?? "monthly",
        label: r.label,
        start: r.start,
        end: r.end,
        paydate: r.paydate,
        notes: r.notes,
        status: r.status ?? "draft",
        lines: Array.isArray(r.lines) ? r.lines : [],
      });
      count++;
    }
    return { count };
  },
});

// ─── 11. INVOICES ─────────────────────────────────────────────

export const importInvoices = mutation({
  args: { sessionToken: v.string(), items: v.array(v.any()) },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx, args.sessionToken);
    let count = 0;
    for (const i of args.items) {
      const clientId = await lookupLegacy(ctx, orgId, "clients", i.ci);
      const businessId = await lookupLegacy(ctx, orgId, "businesses", i.bid);
      await ctx.db.insert("invoices", {
        orgId,
        legacyId: typeof i.id === "number" ? i.id : undefined,
        num: String(i.num ?? ""),
        ci: typeof i.ci === "number" ? i.ci : undefined,
        clientId,
        bid: typeof i.bid === "number" ? i.bid : undefined,
        businessId,
        issueDt: i.issueDt,
        dueDt: i.dueDt,
        paidDt: i.paidDt,
        cu: i.cu ?? "PHP",
        rt: typeof i.rt === "number" ? i.rt : undefined,
        items: Array.isArray(i.items) ? i.items : undefined,
        notes: i.notes,
        terms: i.terms,
        status: i.status ?? "draft",
        payments: Array.isArray(i.payments) ? i.payments : undefined,
      });
      count++;
    }
    return { count };
  },
});

// ─── 12. SALES ────────────────────────────────────────────────

export const importSales = mutation({
  args: { sessionToken: v.string(), items: v.array(v.any()) },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx, args.sessionToken);
    let count = 0;
    for (const s of args.items) {
      const businessId = await lookupLegacy(ctx, orgId, "businesses", s.bid);
      await ctx.db.insert("sales", {
        orgId,
        legacyId: typeof s.id === "number" ? s.id : undefined,
        bid: typeof s.bid === "number" ? s.bid : undefined,
        businessId,
        am: typeof s.am === "number" ? s.am : 0,
        cu: s.cu ?? "PHP",
        rt: typeof s.rt === "number" ? s.rt : undefined,
        dt: s.dt,
        pe: s.pe,
        note: s.note,
      });
      count++;
    }
    return { count };
  },
});

// ─── 13. EXPENSES ─────────────────────────────────────────────

export const importExpenses = mutation({
  args: { sessionToken: v.string(), items: v.array(v.any()) },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx, args.sessionToken);
    let count = 0;
    for (const e of args.items) {
      const businessId = await lookupLegacy(ctx, orgId, "businesses", e.bid);
      await ctx.db.insert("expenses", {
        orgId,
        legacyId: typeof e.id === "number" ? e.id : undefined,
        bid: typeof e.bid === "number" ? e.bid : undefined,
        businessId,
        am: typeof e.am === "number" ? e.am : 0,
        cu: e.cu ?? "PHP",
        rt: typeof e.rt === "number" ? e.rt : undefined,
        dt: e.dt,
        pe: e.pe,
        cat: e.cat,
        note: e.note,
      });
      count++;
    }
    return { count };
  },
});

// ─── 14. CONVICTION FIRSTFRUITS ───────────────────────────────

export const importConvictionFirstfruits = mutation({
  args: { sessionToken: v.string(), items: v.array(v.any()) },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx, args.sessionToken);
    let count = 0;
    for (const cf of args.items) {
      await ctx.db.insert("convictionFirstfruits", {
        orgId,
        legacyId: typeof cf.id === "number" ? cf.id : undefined,
        amount: typeof cf.amount === "number" ? cf.amount : 0,
        pe: cf.pe ?? "",
        dt: cf.dt ?? "",
        note: cf.note,
        loggedAt: cf.loggedAt,
      });
      count++;
    }
    return { count };
  },
});

// ─── 15. APPLICATIONS (Career tracker) ────────────────────────

export const importApplications = mutation({
  args: { sessionToken: v.string(), items: v.array(v.any()) },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx, args.sessionToken);
    let count = 0;
    for (const a of args.items) {
      await ctx.db.insert("applications", {
        orgId,
        legacyId: typeof a.id === "number" ? a.id : undefined,
        company: a.company,
        position: a.position,
        dateApplied: a.dateApplied,
        status: a.status,
        industry: a.industry,
        source: a.source,
        workSetup: a.workSetup,
        location: a.location,
        salary: a.salary,
        url: a.url,
        contactName: a.contactName,
        contactEmail: a.contactEmail,
        contactPhone: a.contactPhone,
        nextAction: a.nextAction,
        nextActionDue: a.nextActionDue,
        jd: a.jd,
        notes: a.notes,
        rejectionReason: a.rejectionReason,
        interviews: Array.isArray(a.interviews) ? a.interviews : undefined,
        lastUpdated: a.lastUpdated,
      });
      count++;
    }
    return { count };
  },
});

// ─── 16. FINALIZE — record an importJobs row for audit ────────

export const recordImportJob = mutation({
  args: {
    sessionToken: v.string(),
    schema: v.string(),
    counts: v.object({
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
    }),
  },
  handler: async (ctx, args) => {
    const { user, orgId } = await requireOrg(ctx, args.sessionToken);
    const now = Date.now();
    await ctx.db.insert("importJobs", {
      orgId,
      userId: user._id,
      schema: args.schema,
      counts: args.counts,
      status: "done",
      startedAt: now,
      finishedAt: now,
    });
    return { ok: true };
  },
});

// ─── DETECT — let the wizard warn if there's already data ────

export const summary = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrg(ctx, args.sessionToken);
    // Cheap shape: just check if a few key tables have anything.
    const has = async (
      tbl: "partners" | "businesses" | "clients" | "payments",
    ) => {
      const row = await ctx.db
        .query(tbl)
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .first();
      return !!row;
    };
    return {
      hasPartners: await has("partners"),
      hasBusinesses: await has("businesses"),
      hasClients: await has("clients"),
      hasPayments: await has("payments"),
    };
  },
});
