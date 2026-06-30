/**
 * Phase 2 — single bulk-fetch for the app shell.
 *
 * `listAll(sessionToken)` returns one big payload shaped like the
 * legacy `S` object the static app.html expects. The frontend
 * hydrates `S` directly from this on load, then runs its existing
 * render code unchanged.
 *
 * The shape is intentionally tolerant — every legacy field name is
 * preserved, and we expose `legacyId` as `id` so the existing render
 * code keeps working with integer ids.
 */
import { query } from "./_generated/server";
import { v } from "convex/values";
import { Doc } from "./_generated/dataModel";
import { loadSession } from "./auth";

// Map a Convex Doc to the legacy `id`-keyed shape. Strips Convex's
// internal `_id`/`_creationTime` and surfaces `legacyId` as `id`.
function legacy<T extends { _id: string; _creationTime: number; legacyId?: number }>(
  doc: T,
  fallbackId?: number,
): Omit<T, "_id" | "_creationTime" | "orgId" | "legacyId"> & { id: number; _convexId: string } {
  const { _id, _creationTime, legacyId, ...rest } = doc as any;
  // Drop `orgId` from the response — frontend doesn't need it.
  delete (rest as any).orgId;
  return {
    ...(rest as Omit<T, "_id" | "_creationTime" | "orgId" | "legacyId">),
    id: typeof legacyId === "number" ? legacyId : (fallbackId ?? 0),
    _convexId: _id,
  };
}

export const listAll = query({
  args: { sessionToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const session = await loadSession(ctx, args.sessionToken);
    if (!session) return null;

    const user = await ctx.db.get(session.userId);
    if (!user) return null;

    const member = await ctx.db
      .query("members")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();
    if (!member) return null;

    const orgId = member.orgId;
    const org = await ctx.db.get(orgId);
    if (!org) return null;

    // Pull every entity for the org in parallel.
    const [
      members,
      partners,
      businesses,
      clients,
      payments,
      salaries,
      attRows,
      obls,
      remitLogs,
      runs,
      invoices,
      sales,
      expenses,
      convictionFirstfruits,
      apps,
    ] = await Promise.all([
      ctx.db.query("members").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
      ctx.db.query("partners").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
      ctx.db.query("businesses").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
      ctx.db.query("clients").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
      ctx.db.query("payments").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
      ctx.db.query("salaries").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
      ctx.db.query("attendance").withIndex("by_org_partner_date", (q) => q.eq("orgId", orgId)).collect(),
      ctx.db.query("obligations").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
      ctx.db.query("remittanceLogs").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
      ctx.db.query("payrollRuns").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
      ctx.db.query("invoices").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
      ctx.db.query("sales").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
      ctx.db.query("expenses").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
      ctx.db.query("convictionFirstfruits").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
      ctx.db.query("applications").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
    ]);

    // Convert attendance rows back into the keyed `att` object the frontend uses.
    const att: Record<string, any> = {};
    attRows.forEach((row) => {
      const pid = row.partnerLegacyId;
      if (typeof pid !== "number" || !row.date) return;
      const key = `${pid}:${row.date}`;
      const { _id, _creationTime, orgId: _o, partnerId: _p, partnerLegacyId: _pl, date: _d, ...rest } = row as any;
      att[key] = rest;
    });

    // Synthesize an S.users array from members so the in-app role
    // gating (`can()`) keeps working unchanged. Phase 1.2b has us at
    // one CEO; future invites will populate this with admin/accountant.
    const usersAsLegacy = members.map((m, i) => ({
      id: i + 1,
      // Stable id round-tripped to syncMembers so email renames patch
      // the same row instead of insert-old-then-delete-new. Carried as
      // a plain string field so the legacy hash/diff layer doesn't
      // choke on Convex Id objects.
      _memberId: String(m._id),
      fn: m.fn,
      ln: m.ln,
      em: m.em,
      pw: "", // never expose passwords; we don't have them anyway under magic-link auth
      role: m.role,
    }));
    const me = members.find((m) => m.userId === user._id);
    const cu = me
      ? {
          id: usersAsLegacy.find((u) => u.em === me.em)?.id ?? 1,
          fn: me.fn,
          ln: me.ln,
          em: me.em,
          pw: "",
          role: me.role,
        }
      : null;

    // Compute "next id" counters from the legacy ids actually present.
    const maxId = (rows: { legacyId?: number }[]) =>
      rows.reduce((m, r) => Math.max(m, r.legacyId ?? 0), 0);
    const nid = {
      p:  maxId(partners) + 1,
      c:  maxId(clients) + 1,
      py: maxId(payments) + 1,
      s:  maxId(salaries) + 1,
      o:  maxId(obls) + 1,
      l:  maxId(remitLogs) + 1,
      r:  maxId(runs) + 1,
      od: 1, // line-level ids — not stored
      ad: 1,
      cr: 1,
      a:  maxId(apps) + 1,
      iv: 1,
      b:  maxId(businesses) + 1,
      sa: maxId(sales) + 1,
      ex: maxId(expenses) + 1,
      u:  Math.max(4, members.length + 1),
      in: maxId(invoices) + 1,
      cc: 1,
      cf: maxId(convictionFirstfruits) + 1,
    };

    return {
      // The frontend matches on these field names directly.
      cfg: {
        name: org.name,
        tin: org.tin ?? "",
        addr: org.addr ?? "",
        natureOfWork: org.natureOfWork ?? "",
        tithe: org.titheRate ?? 10,
        cp: org.cpRate ?? 10,
        logo: org.logo ?? "",
      },
      myProfile: {
        name: me ? `${me.fn} ${me.ln}` : "",
        email: user.email,
        phone: "",
        location: "",
        tagline: "",
        summary: "",
        skills: [],
        certs: [],
        edu: [],
      },
      cu,
      users: usersAsLegacy,
      partners: partners.map((p, i) => legacy(p as any, i + 1)),
      businesses: businesses.map((b, i) => legacy(b as any, i + 1)),
      clients: clients.map((c, i) => legacy(c as any, i + 1)),
      payments: payments.map((p, i) => legacy(p as any, i + 1)),
      salaries: salaries.map((s, i) => legacy(s as any, i + 1)),
      att,
      obls: obls.map((o, i) => legacy(o as any, i + 1)),
      logs: remitLogs.map((l, i) => legacy(l as any, i + 1)),
      runs: runs.map((r, i) => legacy(r as any, i + 1)),
      invoices: invoices.map((i, idx) => legacy(i as any, idx + 1)),
      sales: sales.map((s, i) => legacy(s as any, i + 1)),
      expenses: expenses.map((e, i) => legacy(e as any, i + 1)),
      convictionFirstfruits: convictionFirstfruits.map((cf, i) => legacy(cf as any, i + 1)),
      apps: apps.map((a, i) => legacy(a as any, i + 1)),
      // Phase 2 doesn't touch credits; client-side computeAll re-derives.
      credits: [],
      clientCredits: [],
      nid,
      _orgId: orgId,
      _userId: user._id,
    };
  },
});
