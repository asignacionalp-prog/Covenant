/**
 * Phase 2 — per-entity sync mutations called by app.html on auto-save.
 *
 * Pattern: each mutation takes the full array for one entity type and
 * does an upsert by `legacyId`, deleting any existing rows whose
 * legacyId isn't in the incoming set ("replace-all" semantics).
 *
 * Why per-entity (not one giant snapshot): each call stays under
 * Convex's transaction limit (~8K doc ops). For attendance the
 * frontend chunks into 500-row batches that each do upsert-only
 * (no delete-missing) — see syncAttendanceChunk.
 */
import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { requireSession } from "./auth";

// ─── shared helpers ──────────────────────────────────────────

async function requireOrg(
  ctx: MutationCtx,
  sessionToken: string,
): Promise<Id<"orgs">> {
  const { user } = await requireSession(ctx, sessionToken);
  const member = await ctx.db
    .query("members")
    .withIndex("by_user", (q) => q.eq("userId", user._id))
    .first();
  if (!member) throw new Error("Not part of any org.");
  return member.orgId;
}

const cleanStatus = (s: unknown): "active" | "inactive" =>
  s === "inactive" ? "inactive" : "active";

const num = (v: unknown): number | undefined =>
  typeof v === "number" ? v : undefined;

const str = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;

const bool = (v: unknown): boolean | undefined =>
  typeof v === "boolean" ? v : undefined;

// Resolve a foreign-legacy-id reference into a Convex Id.
async function resolveRef<T extends "businesses" | "partners" | "clients">(
  ctx: MutationCtx,
  orgId: Id<"orgs">,
  table: T,
  legacyId: number | null | undefined,
): Promise<Id<T> | undefined> {
  if (typeof legacyId !== "number") return undefined;
  const row = await ctx.db
    .query(table)
    .withIndex("by_org_legacyId", (q) =>
      q.eq("orgId", orgId).eq("legacyId", legacyId),
    )
    .first();
  return row?._id as Id<T> | undefined;
}

// ─────────────────────────────────────────────────────────────
// PHASE 2c — DIFF MUTATIONS
//
// Each *Diff mutation takes only the rows that actually changed
// since the last successful sync. The handler reads only those
// specific rows (by legacyId or natural key) — not the full org
// table — so I/O scales with edit volume, not data volume.
//
// Frontend tracks per-entity snapshots and computes diffs in
// app.html's bridge. The original mutations (sync<Entity>) are
// preserved below for backwards-compat but are no longer called.
// ─────────────────────────────────────────────────────────────

/**
 * Generic upsert-by-legacyId helper for entity diff mutations.
 * Reads only the specific rows mentioned in the diff.
 */
async function diffApplyByLegacyId<T extends "businesses" | "partners" | "clients" | "payments" | "salaries" | "obligations" | "remittanceLogs" | "payrollRuns" | "invoices" | "sales" | "expenses" | "convictionFirstfruits" | "applications">(
  ctx: MutationCtx,
  orgId: Id<"orgs">,
  table: T,
  upserts: { legacyId: number; data: any }[],
  deletes: number[],
): Promise<{ upserted: number; deleted: number }> {
  let upserted = 0;
  let deleted = 0;
  for (const item of upserts) {
    const existing = await ctx.db
      .query(table)
      .withIndex("by_org_legacyId" as any, (q: any) =>
        q.eq("orgId", orgId).eq("legacyId", item.legacyId),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, item.data);
    } else {
      await ctx.db.insert(table as any, item.data);
    }
    upserted++;
  }
  for (const legacyId of deletes) {
    const existing = await ctx.db
      .query(table)
      .withIndex("by_org_legacyId" as any, (q: any) =>
        q.eq("orgId", orgId).eq("legacyId", legacyId),
      )
      .first();
    if (existing) {
      await ctx.db.delete(existing._id);
      deleted++;
    }
  }
  return { upserted, deleted };
}

export const syncBusinessesDiff = mutation({
  args: {
    sessionToken: v.string(),
    upserts: v.array(v.any()),
    deletes: v.array(v.number()),
  },
  handler: async (ctx, args) => {
    const orgId = await requireOrg(ctx, args.sessionToken);
    const upserts = args.upserts
      .filter((b: any) => typeof b.id === "number")
      .map((b: any) => ({
        legacyId: b.id,
        data: {
          orgId,
          legacyId: b.id,
          nm: b.nm ?? "Untitled",
          type: str(b.type),
          ownerId: num(b.ownerId),
          industry: str(b.industry),
          desc: str(b.desc),
          sd: str(b.sd),
          st: cleanStatus(b.st),
          logo: str(b.logo),
        },
      }));
    return diffApplyByLegacyId(ctx, orgId, "businesses", upserts, args.deletes);
  },
});

export const syncPartnersDiff = mutation({
  args: {
    sessionToken: v.string(),
    upserts: v.array(v.any()),
    deletes: v.array(v.number()),
  },
  handler: async (ctx, args) => {
    const orgId = await requireOrg(ctx, args.sessionToken);
    const upserts = [];
    for (const p of args.upserts) {
      if (typeof p.id !== "number") continue;
      const businessId = await resolveRef(ctx, orgId, "businesses", p.bid);
      upserts.push({
        legacyId: p.id,
        data: {
          orgId,
          legacyId: p.id,
          bid: num(p.bid),
          businessId,
          fn: str(p.fn) ?? "—",
          ln: str(p.ln) ?? "—",
          mn: str(p.mn),
          ex: str(p.ex),
          ct: str(p.ct),
          dob: str(p.dob),
          em: str(p.em),
          gn: str(p.gn),
          cs: str(p.cs),
          pob: str(p.pob),
          ad: str(p.ad),
          sss: str(p.sss),
          tin: str(p.tin),
          pg: str(p.pg),
          ph: str(p.ph),
          ro: str(p.ro),
          sd: str(p.sd),
          st: cleanStatus(p.st),
          sa: num(p.sa),
          cu: str(p.cu),
          eh: num(p.eh),
          hr: num(p.hr),
          tc: bool(p.tc),
          tp: num(p.tp),
          gd: p.gd ? { sss: num(p.gd.sss), ph: num(p.gd.ph), pg: num(p.gd.pg) } : undefined,
          photo: str(p.photo),
          notes: str(p.notes),
          deactivatedAt: str(p.deactivatedAt),
          deactivationReason: str(p.deactivationReason),
        },
      });
    }
    return diffApplyByLegacyId(ctx, orgId, "partners", upserts, args.deletes);
  },
});

export const syncClientsDiff = mutation({
  args: {
    sessionToken: v.string(),
    upserts: v.array(v.any()),
    deletes: v.array(v.number()),
  },
  handler: async (ctx, args) => {
    const orgId = await requireOrg(ctx, args.sessionToken);
    const upserts = [];
    for (const c of args.upserts) {
      if (typeof c.id !== "number") continue;
      const businessId = await resolveRef(ctx, orgId, "businesses", c.bid);
      const partnerId = typeof c.pid === "number"
        ? await resolveRef(ctx, orgId, "partners", c.pid)
        : undefined;
      upserts.push({
        legacyId: c.id,
        data: {
          orgId,
          legacyId: c.id,
          bid: num(c.bid),
          businessId,
          nm: str(c.nm) ?? "Untitled",
          ty: str(c.ty),
          cu: str(c.cu),
          pid: c.pid === null || typeof c.pid === "number" ? c.pid : undefined,
          partnerId,
          st: cleanStatus(c.st),
          sd: str(c.sd),
          pos: str(c.pos),
          resp: Array.isArray(c.resp) ? c.resp : undefined,
          creds: Array.isArray(c.creds) ? c.creds : undefined,
          migrated: bool(c.migrated),
        },
      });
    }
    return diffApplyByLegacyId(ctx, orgId, "clients", upserts, args.deletes);
  },
});

export const syncPaymentsDiff = mutation({
  args: {
    sessionToken: v.string(),
    upserts: v.array(v.any()),
    deletes: v.array(v.number()),
  },
  handler: async (ctx, args) => {
    const orgId = await requireOrg(ctx, args.sessionToken);
    const upserts = [];
    for (const p of args.upserts) {
      if (typeof p.id !== "number") continue;
      const clientId = await resolveRef(ctx, orgId, "clients", p.ci);
      upserts.push({
        legacyId: p.id,
        data: {
          orgId,
          legacyId: p.id,
          ci: num(p.ci),
          clientId,
          am: num(p.am) ?? 0,
          cu: str(p.cu) ?? "PHP",
          rt: num(p.rt),
          dt: str(p.dt),
          pe: str(p.pe),
          source: str(p.source),
          note: str(p.note),
          invoiceId: typeof p.invoiceId === "number" ? p.invoiceId : undefined,
        },
      });
    }
    return diffApplyByLegacyId(ctx, orgId, "payments", upserts, args.deletes);
  },
});

export const syncSalariesDiff = mutation({
  args: {
    sessionToken: v.string(),
    upserts: v.array(v.any()),
    deletes: v.array(v.number()),
  },
  handler: async (ctx, args) => {
    const orgId = await requireOrg(ctx, args.sessionToken);
    const upserts = [];
    for (const s of args.upserts) {
      if (typeof s.id !== "number") continue;
      const partnerId = await resolveRef(ctx, orgId, "partners", s.pid);
      const clientId = await resolveRef(ctx, orgId, "clients", s.ci);
      upserts.push({
        legacyId: s.id,
        data: {
          orgId,
          legacyId: s.id,
          pid: num(s.pid),
          partnerId,
          ci: num(s.ci),
          clientId,
          pc: num(s.pc),
          am: num(s.am) ?? 0,
          cu: str(s.cu) ?? "PHP",
          rt: num(s.rt),
          dt: str(s.dt),
          pe: str(s.pe),
          ad: num(s.ad),
          td: num(s.td),
          od: num(s.od),
          source: str(s.source),
        },
      });
    }
    return diffApplyByLegacyId(ctx, orgId, "salaries", upserts, args.deletes);
  },
});

export const syncObligationsDiff = mutation({
  args: {
    sessionToken: v.string(),
    upserts: v.array(v.any()),
    deletes: v.array(v.number()),
  },
  handler: async (ctx, args) => {
    const orgId = await requireOrg(ctx, args.sessionToken);
    const upserts = [];
    for (const o of args.upserts) {
      if (typeof o.id !== "number") continue;
      const clientId = await resolveRef(ctx, orgId, "clients", o.ci);
      const businessId = await resolveRef(ctx, orgId, "businesses", o.bid);
      const partnerId = await resolveRef(ctx, orgId, "partners", o.ptnId);
      upserts.push({
        legacyId: o.id,
        data: {
          orgId,
          legacyId: o.id,
          ty: str(o.ty) ?? "tithe",
          lb: str(o.lb) ?? "",
          pe: str(o.pe),
          ci: num(o.ci),
          clientId,
          bid: num(o.bid),
          businessId,
          ptnId: num(o.ptnId),
          partnerId,
          tot: num(o.tot) ?? 0,
          bal: num(o.bal) ?? 0,
          key: str(o.key),
          archived: bool(o.archived),
          conviction: bool(o.conviction),
          logs: Array.isArray(o.logs)
            ? o.logs.map((l: any) => ({ logId: num(l.logId), am: num(l.am) ?? 0, dt: str(l.dt) }))
            : undefined,
        },
      });
    }
    return diffApplyByLegacyId(ctx, orgId, "obligations", upserts, args.deletes);
  },
});

export const syncRemittanceLogsDiff = mutation({
  args: {
    sessionToken: v.string(),
    upserts: v.array(v.any()),
    deletes: v.array(v.number()),
  },
  handler: async (ctx, args) => {
    const orgId = await requireOrg(ctx, args.sessionToken);
    const upserts = args.upserts
      .filter((l: any) => typeof l.id === "number")
      .map((l: any) => ({
        legacyId: l.id,
        data: {
          orgId,
          legacyId: l.id,
          dt: str(l.dt) ?? "",
          am: num(l.am) ?? 0,
          mo: str(l.mo),
          by: str(l.by),
          rf: str(l.rf),
          al: Array.isArray(l.al)
            ? l.al.map((a: any) => ({ oi: num(a.oi) ?? 0, am: num(a.am) ?? 0 }))
            : undefined,
          poolAl: Array.isArray(l.poolAl)
            ? l.poolAl.map((p: any) => ({
                ty: str(p.ty) ?? "",
                label: str(p.label),
                am: num(p.am) ?? 0,
                excess: num(p.excess),
              }))
            : undefined,
          creditUsed: num(l.creditUsed),
          creditEarned: num(l.creditEarned),
        },
      }));
    return diffApplyByLegacyId(ctx, orgId, "remittanceLogs", upserts, args.deletes);
  },
});

export const syncPayrollRunsDiff = mutation({
  args: {
    sessionToken: v.string(),
    upserts: v.array(v.any()),
    deletes: v.array(v.number()),
  },
  handler: async (ctx, args) => {
    const orgId = await requireOrg(ctx, args.sessionToken);
    const upserts = args.upserts
      .filter((r: any) => typeof r.id === "number")
      .map((r: any) => ({
        legacyId: r.id,
        data: {
          orgId,
          legacyId: r.id,
          freq: str(r.freq) ?? "monthly",
          label: str(r.label),
          start: str(r.start),
          end: str(r.end),
          paydate: str(r.paydate),
          notes: str(r.notes),
          status: str(r.status) ?? "draft",
          lines: Array.isArray(r.lines) ? r.lines : [],
        },
      }));
    return diffApplyByLegacyId(ctx, orgId, "payrollRuns", upserts, args.deletes);
  },
});

export const syncInvoicesDiff = mutation({
  args: {
    sessionToken: v.string(),
    upserts: v.array(v.any()),
    deletes: v.array(v.number()),
  },
  handler: async (ctx, args) => {
    const orgId = await requireOrg(ctx, args.sessionToken);
    const upserts = [];
    for (const i of args.upserts) {
      if (typeof i.id !== "number") continue;
      const clientId = await resolveRef(ctx, orgId, "clients", i.ci);
      const businessId = await resolveRef(ctx, orgId, "businesses", i.bid);
      upserts.push({
        legacyId: i.id,
        data: {
          orgId,
          legacyId: i.id,
          num: String(i.num ?? ""),
          ci: num(i.ci),
          clientId,
          bid: num(i.bid),
          businessId,
          issueDt: str(i.issueDt),
          dueDt: str(i.dueDt),
          paidDt: str(i.paidDt),
          cu: str(i.cu) ?? "PHP",
          rt: num(i.rt),
          items: Array.isArray(i.items) ? i.items : undefined,
          notes: str(i.notes),
          terms: str(i.terms),
          status: str(i.status) ?? "draft",
          payments: Array.isArray(i.payments) ? i.payments : undefined,
        },
      });
    }
    return diffApplyByLegacyId(ctx, orgId, "invoices", upserts, args.deletes);
  },
});

export const syncSalesDiff = mutation({
  args: {
    sessionToken: v.string(),
    upserts: v.array(v.any()),
    deletes: v.array(v.number()),
  },
  handler: async (ctx, args) => {
    const orgId = await requireOrg(ctx, args.sessionToken);
    const upserts = [];
    for (const s of args.upserts) {
      if (typeof s.id !== "number") continue;
      const businessId = await resolveRef(ctx, orgId, "businesses", s.bid);
      upserts.push({
        legacyId: s.id,
        data: {
          orgId,
          legacyId: s.id,
          bid: num(s.bid),
          businessId,
          am: num(s.am) ?? 0,
          cu: str(s.cu) ?? "PHP",
          rt: num(s.rt),
          dt: str(s.dt),
          pe: str(s.pe),
          note: str(s.note),
        },
      });
    }
    return diffApplyByLegacyId(ctx, orgId, "sales", upserts, args.deletes);
  },
});

export const syncExpensesDiff = mutation({
  args: {
    sessionToken: v.string(),
    upserts: v.array(v.any()),
    deletes: v.array(v.number()),
  },
  handler: async (ctx, args) => {
    const orgId = await requireOrg(ctx, args.sessionToken);
    const upserts = [];
    for (const e of args.upserts) {
      if (typeof e.id !== "number") continue;
      const businessId = await resolveRef(ctx, orgId, "businesses", e.bid);
      upserts.push({
        legacyId: e.id,
        data: {
          orgId,
          legacyId: e.id,
          bid: num(e.bid),
          businessId,
          am: num(e.am) ?? 0,
          cu: str(e.cu) ?? "PHP",
          rt: num(e.rt),
          dt: str(e.dt),
          pe: str(e.pe),
          cat: str(e.cat),
          note: str(e.note),
        },
      });
    }
    return diffApplyByLegacyId(ctx, orgId, "expenses", upserts, args.deletes);
  },
});

export const syncConvictionFirstfruitsDiff = mutation({
  args: {
    sessionToken: v.string(),
    upserts: v.array(v.any()),
    deletes: v.array(v.number()),
  },
  handler: async (ctx, args) => {
    const orgId = await requireOrg(ctx, args.sessionToken);
    const upserts = args.upserts
      .filter((cf: any) => typeof cf.id === "number")
      .map((cf: any) => ({
        legacyId: cf.id,
        data: {
          orgId,
          legacyId: cf.id,
          amount: num(cf.amount) ?? 0,
          pe: str(cf.pe) ?? "",
          dt: str(cf.dt) ?? "",
          note: str(cf.note),
          loggedAt: str(cf.loggedAt),
        },
      }));
    return diffApplyByLegacyId(ctx, orgId, "convictionFirstfruits", upserts, args.deletes);
  },
});

export const syncApplicationsDiff = mutation({
  args: {
    sessionToken: v.string(),
    upserts: v.array(v.any()),
    deletes: v.array(v.number()),
  },
  handler: async (ctx, args) => {
    const orgId = await requireOrg(ctx, args.sessionToken);
    const upserts = args.upserts
      .filter((a: any) => typeof a.id === "number")
      .map((a: any) => ({
        legacyId: a.id,
        data: {
          orgId,
          legacyId: a.id,
          company: str(a.company),
          position: str(a.position),
          dateApplied: str(a.dateApplied),
          status: str(a.status),
          industry: str(a.industry),
          source: str(a.source),
          workSetup: str(a.workSetup),
          location: str(a.location),
          salary: str(a.salary),
          url: str(a.url),
          contactName: str(a.contactName),
          contactEmail: str(a.contactEmail),
          contactPhone: str(a.contactPhone),
          nextAction: str(a.nextAction),
          nextActionDue: str(a.nextActionDue),
          jd: str(a.jd),
          notes: str(a.notes),
          rejectionReason: str(a.rejectionReason),
          interviews: Array.isArray(a.interviews) ? a.interviews : undefined,
          lastUpdated: str(a.lastUpdated),
        },
      }));
    return diffApplyByLegacyId(ctx, orgId, "applications", upserts, args.deletes);
  },
});

/**
 * Attendance diff sync — uses natural key (partnerLegacyId, date)
 * instead of legacyId since the table has no legacyId field.
 */
export const syncAttendanceDiff = mutation({
  args: {
    sessionToken: v.string(),
    upserts: v.array(v.any()),
    deletes: v.array(v.object({ partnerId: v.number(), date: v.string() })),
  },
  handler: async (ctx, args) => {
    const orgId = await requireOrg(ctx, args.sessionToken);
    let upserted = 0;
    let deleted = 0;

    for (const a of args.upserts) {
      const partnerLegacyId = typeof a.partnerId === "number" ? a.partnerId : null;
      const date = String(a.date ?? "");
      if (!partnerLegacyId || !date) continue;
      const partnerId = await resolveRef(ctx, orgId, "partners", partnerLegacyId);
      const existing = await ctx.db
        .query("attendance")
        .withIndex("by_org_partner_date", (q) =>
          q.eq("orgId", orgId).eq("partnerId", partnerId as any).eq("date", date),
        )
        .first();
      const data = {
        orgId,
        partnerLegacyId,
        partnerId,
        date,
        st: str(a.st),
        lm: num(a.lm),
        um: num(a.um),
        om: num(a.om),
        notes: str(a.notes),
        dv: str(a.dv),
        ss: str(a.ss),
        ca: str(a.ca),
      };
      if (existing) await ctx.db.patch(existing._id, data);
      else await ctx.db.insert("attendance", data);
      upserted++;
    }

    for (const d of args.deletes) {
      if (typeof d.partnerId !== "number" || !d.date) continue;
      const partnerId = await resolveRef(ctx, orgId, "partners", d.partnerId);
      const existing = await ctx.db
        .query("attendance")
        .withIndex("by_org_partner_date", (q) =>
          q.eq("orgId", orgId).eq("partnerId", partnerId as any).eq("date", d.date),
        )
        .first();
      if (existing) {
        await ctx.db.delete(existing._id);
        deleted++;
      }
    }

    return { upserted, deleted };
  },
});

// ─── 0. MEMBERS (team — CEO / admin / accountant) ───────────
//
// `S.users` in the app is synthesized from this table by data.listAll.
// We round-trip it back here so adding/editing/removing team members
// in the Users page actually persists across refreshes.
//
// Natural key = lowercased email. Two safety guards:
//   1. Never delete the calling user's own member row — protects
//      against a race where the frontend syncs an empty array
//      before listAll finishes hydrating
//   2. Never demote the caller out of `ceo` role — if their incoming
//      record claims a non-ceo role for them (UI bug), we ignore the
//      role change for self specifically

export const syncMembers = mutation({
  args: { sessionToken: v.string(), items: v.array(v.any()) },
  handler: async (ctx, args) => {
    const orgId = await requireOrg(ctx, args.sessionToken);
    // Resolve the caller so we can protect their own member row.
    const { user: callerUser } = await requireSession(ctx, args.sessionToken);
    const callerEmail = (callerUser.email || "").trim().toLowerCase();

    const existing = await ctx.db
      .query("members")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();

    const existingByEmail = new Map<string, Doc<"members">>();
    existing.forEach((m) => {
      const k = (m.em || "").trim().toLowerCase();
      if (k) existingByEmail.set(k, m);
    });

    const incomingEmails = new Set<string>();
    for (const u of args.items) {
      if (!u || typeof u !== "object") continue;
      const em = String(u.em || "").trim().toLowerCase();
      if (!em || !em.includes("@")) continue;
      incomingEmails.add(em);

      const rawRole = u.role;
      const isValidRole =
        rawRole === "ceo" || rawRole === "admin" || rawRole === "accountant";
      const role = isValidRole ? rawRole : "admin";
      const fn = String(u.fn || "").trim() || "—";
      const ln = String(u.ln || "").trim() || "—";

      const match = existingByEmail.get(em);
      if (match) {
        // Guard: never demote the caller's own role away from ceo.
        const safeRole = em === callerEmail && match.role === "ceo" ? "ceo" : role;
        await ctx.db.patch(match._id, { fn, ln, em, role: safeRole });
      } else {
        // New invite — userId stays undefined until they sign in.
        await ctx.db.insert("members", {
          orgId,
          role,
          fn,
          ln,
          em,
          invitedAt: Date.now(),
          status: "active",
        });
      }
    }

    // Delete missing — but protect the caller's own row.
    for (const m of existing) {
      const em = (m.em || "").trim().toLowerCase();
      if (em === callerEmail) continue;
      if (!incomingEmails.has(em)) {
        await ctx.db.delete(m._id);
      }
    }

    return { count: args.items.length };
  },
});

// ─── 1. ORG CONFIG ───────────────────────────────────────────

export const syncOrgConfig = mutation({
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
    const orgId = await requireOrg(ctx, args.sessionToken);
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

// ─── 2. BUSINESSES ───────────────────────────────────────────

export const syncBusinesses = mutation({
  args: { sessionToken: v.string(), items: v.array(v.any()) },
  handler: async (ctx, args) => {
    const orgId = await requireOrg(ctx, args.sessionToken);
    const existing = await ctx.db
      .query("businesses")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const incomingIds = new Set<number>();
    args.items.forEach((b: any) => {
      if (typeof b.id === "number") incomingIds.add(b.id);
    });
    // Delete missing.
    for (const row of existing) {
      if (row.legacyId == null || !incomingIds.has(row.legacyId)) {
        await ctx.db.delete(row._id);
      }
    }
    // Upsert.
    const existingMap = new Map<number, Doc<"businesses">>();
    existing.forEach((r) => {
      if (r.legacyId != null) existingMap.set(r.legacyId, r);
    });
    for (let i = 0; i < args.items.length; i++) {
      const b = args.items[i];
      const legacyId = typeof b.id === "number" ? b.id : i + 1;
      const data = {
        orgId,
        legacyId,
        nm: b.nm ?? "Untitled",
        type: str(b.type),
        ownerId: num(b.ownerId),
        industry: str(b.industry),
        desc: str(b.desc),
        sd: str(b.sd),
        st: cleanStatus(b.st),
        logo: str(b.logo),
      };
      const match = existingMap.get(legacyId);
      if (match) await ctx.db.patch(match._id, data);
      else await ctx.db.insert("businesses", data);
    }
    return { count: args.items.length };
  },
});

// ─── 3. PARTNERS ─────────────────────────────────────────────

export const syncPartners = mutation({
  args: { sessionToken: v.string(), items: v.array(v.any()) },
  handler: async (ctx, args) => {
    const orgId = await requireOrg(ctx, args.sessionToken);
    const existing = await ctx.db
      .query("partners")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const incomingIds = new Set<number>();
    args.items.forEach((p: any) => {
      if (typeof p.id === "number") incomingIds.add(p.id);
    });
    for (const row of existing) {
      if (row.legacyId == null || !incomingIds.has(row.legacyId)) {
        await ctx.db.delete(row._id);
      }
    }
    const existingMap = new Map<number, Doc<"partners">>();
    existing.forEach((r) => {
      if (r.legacyId != null) existingMap.set(r.legacyId, r);
    });
    for (let i = 0; i < args.items.length; i++) {
      const p = args.items[i];
      const legacyId = typeof p.id === "number" ? p.id : i + 1;
      const businessId = await resolveRef(ctx, orgId, "businesses", p.bid);
      const data = {
        orgId,
        legacyId,
        bid: num(p.bid),
        businessId,
        fn: str(p.fn) ?? "—",
        ln: str(p.ln) ?? "—",
        mn: str(p.mn),
        ex: str(p.ex),
        ct: str(p.ct),
        dob: str(p.dob),
        em: str(p.em),
        gn: str(p.gn),
        cs: str(p.cs),
        pob: str(p.pob),
        ad: str(p.ad),
        sss: str(p.sss),
        tin: str(p.tin),
        pg: str(p.pg),
        ph: str(p.ph),
        ro: str(p.ro),
        sd: str(p.sd),
        st: cleanStatus(p.st),
        sa: num(p.sa),
        cu: str(p.cu),
        eh: num(p.eh),
        hr: num(p.hr),
        tc: bool(p.tc),
        tp: num(p.tp),
        gd: p.gd
          ? { sss: num(p.gd.sss), ph: num(p.gd.ph), pg: num(p.gd.pg) }
          : undefined,
        photo: str(p.photo),
        notes: str(p.notes),
        deactivatedAt: str(p.deactivatedAt),
        deactivationReason: str(p.deactivationReason),
      };
      const match = existingMap.get(legacyId);
      if (match) await ctx.db.patch(match._id, data);
      else await ctx.db.insert("partners", data);
    }
    return { count: args.items.length };
  },
});

// ─── 4. CLIENTS ──────────────────────────────────────────────

export const syncClients = mutation({
  args: { sessionToken: v.string(), items: v.array(v.any()) },
  handler: async (ctx, args) => {
    const orgId = await requireOrg(ctx, args.sessionToken);
    const existing = await ctx.db
      .query("clients")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const incomingIds = new Set<number>();
    args.items.forEach((c: any) => {
      if (typeof c.id === "number") incomingIds.add(c.id);
    });
    for (const row of existing) {
      if (row.legacyId == null || !incomingIds.has(row.legacyId)) {
        await ctx.db.delete(row._id);
      }
    }
    const existingMap = new Map<number, Doc<"clients">>();
    existing.forEach((r) => {
      if (r.legacyId != null) existingMap.set(r.legacyId, r);
    });
    for (let i = 0; i < args.items.length; i++) {
      const c = args.items[i];
      const legacyId = typeof c.id === "number" ? c.id : i + 1;
      const businessId = await resolveRef(ctx, orgId, "businesses", c.bid);
      const partnerId =
        typeof c.pid === "number"
          ? await resolveRef(ctx, orgId, "partners", c.pid)
          : undefined;
      const data = {
        orgId,
        legacyId,
        bid: num(c.bid),
        businessId,
        nm: str(c.nm) ?? "Untitled",
        ty: str(c.ty),
        cu: str(c.cu),
        pid: c.pid === null || typeof c.pid === "number" ? c.pid : undefined,
        partnerId,
        st: cleanStatus(c.st),
        sd: str(c.sd),
        pos: str(c.pos),
        resp: Array.isArray(c.resp) ? c.resp : undefined,
        creds: Array.isArray(c.creds) ? c.creds : undefined,
        migrated: bool(c.migrated),
      };
      const match = existingMap.get(legacyId);
      if (match) await ctx.db.patch(match._id, data);
      else await ctx.db.insert("clients", data);
    }
    return { count: args.items.length };
  },
});

// ─── 5. PAYMENTS ─────────────────────────────────────────────

export const syncPayments = mutation({
  args: { sessionToken: v.string(), items: v.array(v.any()) },
  handler: async (ctx, args) => {
    const orgId = await requireOrg(ctx, args.sessionToken);
    const existing = await ctx.db
      .query("payments")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const incomingIds = new Set<number>();
    args.items.forEach((p: any) => {
      if (typeof p.id === "number") incomingIds.add(p.id);
    });
    for (const row of existing) {
      if (row.legacyId == null || !incomingIds.has(row.legacyId)) {
        await ctx.db.delete(row._id);
      }
    }
    const existingMap = new Map<number, Doc<"payments">>();
    existing.forEach((r) => {
      if (r.legacyId != null) existingMap.set(r.legacyId, r);
    });
    for (const p of args.items) {
      const legacyId = typeof p.id === "number" ? p.id : 0;
      if (legacyId === 0) continue;
      const clientId = await resolveRef(ctx, orgId, "clients", p.ci);
      const data = {
        orgId,
        legacyId,
        ci: num(p.ci),
        clientId,
        am: num(p.am) ?? 0,
        cu: str(p.cu) ?? "PHP",
        rt: num(p.rt),
        dt: str(p.dt),
        pe: str(p.pe),
        source: str(p.source),
        note: str(p.note),
        invoiceId: typeof p.invoiceId === "number" ? p.invoiceId : undefined,
      };
      const match = existingMap.get(legacyId);
      if (match) await ctx.db.patch(match._id, data);
      else await ctx.db.insert("payments", data);
    }
    return { count: args.items.length };
  },
});

// ─── 6. SALARIES ─────────────────────────────────────────────

export const syncSalaries = mutation({
  args: { sessionToken: v.string(), items: v.array(v.any()) },
  handler: async (ctx, args) => {
    const orgId = await requireOrg(ctx, args.sessionToken);
    const existing = await ctx.db
      .query("salaries")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const incomingIds = new Set<number>();
    args.items.forEach((s: any) => {
      if (typeof s.id === "number") incomingIds.add(s.id);
    });
    for (const row of existing) {
      if (row.legacyId == null || !incomingIds.has(row.legacyId)) {
        await ctx.db.delete(row._id);
      }
    }
    const existingMap = new Map<number, Doc<"salaries">>();
    existing.forEach((r) => {
      if (r.legacyId != null) existingMap.set(r.legacyId, r);
    });
    for (const s of args.items) {
      const legacyId = typeof s.id === "number" ? s.id : 0;
      if (legacyId === 0) continue;
      const partnerId = await resolveRef(ctx, orgId, "partners", s.pid);
      const clientId = await resolveRef(ctx, orgId, "clients", s.ci);
      const data = {
        orgId,
        legacyId,
        pid: num(s.pid),
        partnerId,
        ci: num(s.ci),
        clientId,
        pc: num(s.pc),
        am: num(s.am) ?? 0,
        cu: str(s.cu) ?? "PHP",
        rt: num(s.rt),
        dt: str(s.dt),
        pe: str(s.pe),
        ad: num(s.ad),
        td: num(s.td),
        od: num(s.od),
        source: str(s.source),
      };
      const match = existingMap.get(legacyId);
      if (match) await ctx.db.patch(match._id, data);
      else await ctx.db.insert("salaries", data);
    }
    return { count: args.items.length };
  },
});

// ─── 7. ATTENDANCE — chunk + replace-by-natural-key ──────────

/**
 * Attendance has no legacyId — natural key is (partnerLegacyId, date).
 * The frontend sends one chunk at a time. To support delete-missing
 * across chunks, we accept a `chunkIndex` + `chunkCount` plus the full
 * set of natural keys that should remain after all chunks process.
 *
 * Simpler approach for v1: frontend sends ALL keys it intends to sync
 * (potentially across multiple chunks) via `expectedKeys`. On the FIRST
 * chunk (chunkIndex===0), we do the delete-missing pass. Subsequent
 * chunks just upsert.
 */
export const syncAttendanceChunk = mutation({
  args: {
    sessionToken: v.string(),
    items: v.array(v.any()), // [{ partnerId, date, st, lm, um, om, notes, dv, ss, ca }, ...]
    chunkIndex: v.number(),
    expectedKeys: v.optional(v.array(v.string())), // "pid:date" strings — present only on first chunk
  },
  handler: async (ctx, args) => {
    const orgId = await requireOrg(ctx, args.sessionToken);

    // First chunk: delete any rows not in expectedKeys.
    if (args.chunkIndex === 0 && args.expectedKeys) {
      const keep = new Set(args.expectedKeys);
      const existing = await ctx.db
        .query("attendance")
        .withIndex("by_org_partner_date", (q) => q.eq("orgId", orgId))
        .collect();
      for (const row of existing) {
        if (typeof row.partnerLegacyId !== "number" || !row.date) continue;
        const k = `${row.partnerLegacyId}:${row.date}`;
        if (!keep.has(k)) await ctx.db.delete(row._id);
      }
    }

    // Upsert each item by natural key.
    for (const a of args.items) {
      const partnerLegacyId =
        typeof a.partnerId === "number" ? a.partnerId : null;
      const date = String(a.date ?? "");
      if (!partnerLegacyId || !date) continue;
      const partnerId = await resolveRef(ctx, orgId, "partners", partnerLegacyId);
      const existing = await ctx.db
        .query("attendance")
        .withIndex("by_org_partner_date", (q) =>
          q.eq("orgId", orgId).eq("partnerId", partnerId as any).eq("date", date),
        )
        .first();
      const data = {
        orgId,
        partnerLegacyId,
        partnerId,
        date,
        st: str(a.st),
        lm: num(a.lm),
        um: num(a.um),
        om: num(a.om),
        notes: str(a.notes),
        dv: str(a.dv),
        ss: str(a.ss),
        ca: str(a.ca),
      };
      if (existing) await ctx.db.patch(existing._id, data);
      else await ctx.db.insert("attendance", data);
    }
    return { count: args.items.length };
  },
});

// ─── 8. OBLIGATIONS ──────────────────────────────────────────

export const syncObligations = mutation({
  args: { sessionToken: v.string(), items: v.array(v.any()) },
  handler: async (ctx, args) => {
    const orgId = await requireOrg(ctx, args.sessionToken);
    const existing = await ctx.db
      .query("obligations")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const incomingIds = new Set<number>();
    args.items.forEach((o: any) => {
      if (typeof o.id === "number") incomingIds.add(o.id);
    });
    for (const row of existing) {
      if (row.legacyId == null || !incomingIds.has(row.legacyId)) {
        await ctx.db.delete(row._id);
      }
    }
    const existingMap = new Map<number, Doc<"obligations">>();
    existing.forEach((r) => {
      if (r.legacyId != null) existingMap.set(r.legacyId, r);
    });
    for (const o of args.items) {
      const legacyId = typeof o.id === "number" ? o.id : 0;
      if (legacyId === 0) continue;
      const clientId = await resolveRef(ctx, orgId, "clients", o.ci);
      const businessId = await resolveRef(ctx, orgId, "businesses", o.bid);
      const partnerId = await resolveRef(ctx, orgId, "partners", o.ptnId);
      const data = {
        orgId,
        legacyId,
        ty: str(o.ty) ?? "tithe",
        lb: str(o.lb) ?? "",
        pe: str(o.pe),
        ci: num(o.ci),
        clientId,
        bid: num(o.bid),
        businessId,
        ptnId: num(o.ptnId),
        partnerId,
        tot: num(o.tot) ?? 0,
        bal: num(o.bal) ?? 0,
        key: str(o.key),
        archived: bool(o.archived),
        conviction: bool(o.conviction),
        logs: Array.isArray(o.logs)
          ? o.logs.map((l: any) => ({
              logId: num(l.logId),
              am: num(l.am) ?? 0,
              dt: str(l.dt),
            }))
          : undefined,
      };
      const match = existingMap.get(legacyId);
      if (match) await ctx.db.patch(match._id, data);
      else await ctx.db.insert("obligations", data);
    }
    return { count: args.items.length };
  },
});

// ─── 9. REMITTANCE LOGS ──────────────────────────────────────

export const syncRemittanceLogs = mutation({
  args: { sessionToken: v.string(), items: v.array(v.any()) },
  handler: async (ctx, args) => {
    const orgId = await requireOrg(ctx, args.sessionToken);
    const existing = await ctx.db
      .query("remittanceLogs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const incomingIds = new Set<number>();
    args.items.forEach((l: any) => {
      if (typeof l.id === "number") incomingIds.add(l.id);
    });
    for (const row of existing) {
      if (row.legacyId == null || !incomingIds.has(row.legacyId)) {
        await ctx.db.delete(row._id);
      }
    }
    const existingMap = new Map<number, Doc<"remittanceLogs">>();
    existing.forEach((r) => {
      if (r.legacyId != null) existingMap.set(r.legacyId, r);
    });
    for (const l of args.items) {
      const legacyId = typeof l.id === "number" ? l.id : 0;
      if (legacyId === 0) continue;
      const data = {
        orgId,
        legacyId,
        dt: str(l.dt) ?? "",
        am: num(l.am) ?? 0,
        mo: str(l.mo),
        by: str(l.by),
        rf: str(l.rf),
        al: Array.isArray(l.al)
          ? l.al.map((a: any) => ({ oi: num(a.oi) ?? 0, am: num(a.am) ?? 0 }))
          : undefined,
        poolAl: Array.isArray(l.poolAl)
          ? l.poolAl.map((p: any) => ({
              ty: str(p.ty) ?? "",
              label: str(p.label),
              am: num(p.am) ?? 0,
              excess: num(p.excess),
            }))
          : undefined,
        creditUsed: num(l.creditUsed),
        creditEarned: num(l.creditEarned),
      };
      const match = existingMap.get(legacyId);
      if (match) await ctx.db.patch(match._id, data);
      else await ctx.db.insert("remittanceLogs", data);
    }
    return { count: args.items.length };
  },
});

// ─── 10. PAYROLL RUNS ────────────────────────────────────────

export const syncPayrollRuns = mutation({
  args: { sessionToken: v.string(), items: v.array(v.any()) },
  handler: async (ctx, args) => {
    const orgId = await requireOrg(ctx, args.sessionToken);
    const existing = await ctx.db
      .query("payrollRuns")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const incomingIds = new Set<number>();
    args.items.forEach((r: any) => {
      if (typeof r.id === "number") incomingIds.add(r.id);
    });
    for (const row of existing) {
      if (row.legacyId == null || !incomingIds.has(row.legacyId)) {
        await ctx.db.delete(row._id);
      }
    }
    const existingMap = new Map<number, Doc<"payrollRuns">>();
    existing.forEach((r) => {
      if (r.legacyId != null) existingMap.set(r.legacyId, r);
    });
    for (const r of args.items) {
      const legacyId = typeof r.id === "number" ? r.id : 0;
      if (legacyId === 0) continue;
      const data = {
        orgId,
        legacyId,
        freq: str(r.freq) ?? "monthly",
        label: str(r.label),
        start: str(r.start),
        end: str(r.end),
        paydate: str(r.paydate),
        notes: str(r.notes),
        status: str(r.status) ?? "draft",
        lines: Array.isArray(r.lines) ? r.lines : [],
      };
      const match = existingMap.get(legacyId);
      if (match) await ctx.db.patch(match._id, data);
      else await ctx.db.insert("payrollRuns", data);
    }
    return { count: args.items.length };
  },
});

// ─── 11. INVOICES ────────────────────────────────────────────

export const syncInvoices = mutation({
  args: { sessionToken: v.string(), items: v.array(v.any()) },
  handler: async (ctx, args) => {
    const orgId = await requireOrg(ctx, args.sessionToken);
    const existing = await ctx.db
      .query("invoices")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const incomingIds = new Set<number>();
    args.items.forEach((i: any) => {
      if (typeof i.id === "number") incomingIds.add(i.id);
    });
    for (const row of existing) {
      if (row.legacyId == null || !incomingIds.has(row.legacyId)) {
        await ctx.db.delete(row._id);
      }
    }
    const existingMap = new Map<number, Doc<"invoices">>();
    existing.forEach((r) => {
      if (r.legacyId != null) existingMap.set(r.legacyId, r);
    });
    for (const i of args.items) {
      const legacyId = typeof i.id === "number" ? i.id : 0;
      if (legacyId === 0) continue;
      const clientId = await resolveRef(ctx, orgId, "clients", i.ci);
      const businessId = await resolveRef(ctx, orgId, "businesses", i.bid);
      const data = {
        orgId,
        legacyId,
        num: String(i.num ?? ""),
        ci: num(i.ci),
        clientId,
        bid: num(i.bid),
        businessId,
        issueDt: str(i.issueDt),
        dueDt: str(i.dueDt),
        paidDt: str(i.paidDt),
        cu: str(i.cu) ?? "PHP",
        rt: num(i.rt),
        items: Array.isArray(i.items) ? i.items : undefined,
        notes: str(i.notes),
        terms: str(i.terms),
        status: str(i.status) ?? "draft",
        payments: Array.isArray(i.payments) ? i.payments : undefined,
      };
      const match = existingMap.get(legacyId);
      if (match) await ctx.db.patch(match._id, data);
      else await ctx.db.insert("invoices", data);
    }
    return { count: args.items.length };
  },
});

// ─── 12. SALES ───────────────────────────────────────────────

export const syncSales = mutation({
  args: { sessionToken: v.string(), items: v.array(v.any()) },
  handler: async (ctx, args) => {
    const orgId = await requireOrg(ctx, args.sessionToken);
    const existing = await ctx.db
      .query("sales")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const incomingIds = new Set<number>();
    args.items.forEach((s: any) => {
      if (typeof s.id === "number") incomingIds.add(s.id);
    });
    for (const row of existing) {
      if (row.legacyId == null || !incomingIds.has(row.legacyId)) {
        await ctx.db.delete(row._id);
      }
    }
    const existingMap = new Map<number, Doc<"sales">>();
    existing.forEach((r) => {
      if (r.legacyId != null) existingMap.set(r.legacyId, r);
    });
    for (const s of args.items) {
      const legacyId = typeof s.id === "number" ? s.id : 0;
      if (legacyId === 0) continue;
      const businessId = await resolveRef(ctx, orgId, "businesses", s.bid);
      const data = {
        orgId,
        legacyId,
        bid: num(s.bid),
        businessId,
        am: num(s.am) ?? 0,
        cu: str(s.cu) ?? "PHP",
        rt: num(s.rt),
        dt: str(s.dt),
        pe: str(s.pe),
        note: str(s.note),
      };
      const match = existingMap.get(legacyId);
      if (match) await ctx.db.patch(match._id, data);
      else await ctx.db.insert("sales", data);
    }
    return { count: args.items.length };
  },
});

// ─── 13. EXPENSES ────────────────────────────────────────────

export const syncExpenses = mutation({
  args: { sessionToken: v.string(), items: v.array(v.any()) },
  handler: async (ctx, args) => {
    const orgId = await requireOrg(ctx, args.sessionToken);
    const existing = await ctx.db
      .query("expenses")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const incomingIds = new Set<number>();
    args.items.forEach((e: any) => {
      if (typeof e.id === "number") incomingIds.add(e.id);
    });
    for (const row of existing) {
      if (row.legacyId == null || !incomingIds.has(row.legacyId)) {
        await ctx.db.delete(row._id);
      }
    }
    const existingMap = new Map<number, Doc<"expenses">>();
    existing.forEach((r) => {
      if (r.legacyId != null) existingMap.set(r.legacyId, r);
    });
    for (const e of args.items) {
      const legacyId = typeof e.id === "number" ? e.id : 0;
      if (legacyId === 0) continue;
      const businessId = await resolveRef(ctx, orgId, "businesses", e.bid);
      const data = {
        orgId,
        legacyId,
        bid: num(e.bid),
        businessId,
        am: num(e.am) ?? 0,
        cu: str(e.cu) ?? "PHP",
        rt: num(e.rt),
        dt: str(e.dt),
        pe: str(e.pe),
        cat: str(e.cat),
        note: str(e.note),
      };
      const match = existingMap.get(legacyId);
      if (match) await ctx.db.patch(match._id, data);
      else await ctx.db.insert("expenses", data);
    }
    return { count: args.items.length };
  },
});

// ─── 14. CONVICTION FIRSTFRUITS ──────────────────────────────

export const syncConvictionFirstfruits = mutation({
  args: { sessionToken: v.string(), items: v.array(v.any()) },
  handler: async (ctx, args) => {
    const orgId = await requireOrg(ctx, args.sessionToken);
    const existing = await ctx.db
      .query("convictionFirstfruits")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const incomingIds = new Set<number>();
    args.items.forEach((cf: any) => {
      if (typeof cf.id === "number") incomingIds.add(cf.id);
    });
    for (const row of existing) {
      if (row.legacyId == null || !incomingIds.has(row.legacyId)) {
        await ctx.db.delete(row._id);
      }
    }
    const existingMap = new Map<number, Doc<"convictionFirstfruits">>();
    existing.forEach((r) => {
      if (r.legacyId != null) existingMap.set(r.legacyId, r);
    });
    for (const cf of args.items) {
      const legacyId = typeof cf.id === "number" ? cf.id : 0;
      if (legacyId === 0) continue;
      const data = {
        orgId,
        legacyId,
        amount: num(cf.amount) ?? 0,
        pe: str(cf.pe) ?? "",
        dt: str(cf.dt) ?? "",
        note: str(cf.note),
        loggedAt: str(cf.loggedAt),
      };
      const match = existingMap.get(legacyId);
      if (match) await ctx.db.patch(match._id, data);
      else await ctx.db.insert("convictionFirstfruits", data);
    }
    return { count: args.items.length };
  },
});

// ─── 15. APPLICATIONS ────────────────────────────────────────

export const syncApplications = mutation({
  args: { sessionToken: v.string(), items: v.array(v.any()) },
  handler: async (ctx, args) => {
    const orgId = await requireOrg(ctx, args.sessionToken);
    const existing = await ctx.db
      .query("applications")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const incomingIds = new Set<number>();
    args.items.forEach((a: any) => {
      if (typeof a.id === "number") incomingIds.add(a.id);
    });
    for (const row of existing) {
      if (row.legacyId == null || !incomingIds.has(row.legacyId)) {
        await ctx.db.delete(row._id);
      }
    }
    const existingMap = new Map<number, Doc<"applications">>();
    existing.forEach((r) => {
      if (r.legacyId != null) existingMap.set(r.legacyId, r);
    });
    for (const a of args.items) {
      const legacyId = typeof a.id === "number" ? a.id : 0;
      if (legacyId === 0) continue;
      const data = {
        orgId,
        legacyId,
        company: str(a.company),
        position: str(a.position),
        dateApplied: str(a.dateApplied),
        status: str(a.status),
        industry: str(a.industry),
        source: str(a.source),
        workSetup: str(a.workSetup),
        location: str(a.location),
        salary: str(a.salary),
        url: str(a.url),
        contactName: str(a.contactName),
        contactEmail: str(a.contactEmail),
        contactPhone: str(a.contactPhone),
        nextAction: str(a.nextAction),
        nextActionDue: str(a.nextActionDue),
        jd: str(a.jd),
        notes: str(a.notes),
        rejectionReason: str(a.rejectionReason),
        interviews: Array.isArray(a.interviews) ? a.interviews : undefined,
        lastUpdated: str(a.lastUpdated),
      };
      const match = existingMap.get(legacyId);
      if (match) await ctx.db.patch(match._id, data);
      else await ctx.db.insert("applications", data);
    }
    return { count: args.items.length };
  },
});
