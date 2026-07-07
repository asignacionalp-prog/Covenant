/**
 * Church master account — sees aggregate + personnel data across
 * every Home Office org whose `churchId` matches. A church is NOT a
 * user (no member row, no /app.html session). It has its own auth
 * table (`churches`) and session table (`churchSessions`).
 *
 * Auth: signInChurch → verifies PBKDF2 hash → creates a churchSession.
 * Data queries: overview / byHomeOffice / homeOfficeDetail. Every
 * query verifies the caller's sessionToken corresponds to the church
 * whose data is being read.
 *
 * PBKDF2 params match auth.ts hashPassword so credentials can be
 * created either here or by the same client-side hash used elsewhere.
 */
import { mutation, query, action } from "./_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx, MutationCtx } from "./_generated/server";

const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_SALT_BYTES = 16;
const PBKDF2_HASH_BYTES = 32;

const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function hashPassword(password: string): Promise<string> {
  if (typeof password !== "string" || password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }
  const salt = crypto.getRandomValues(new Uint8Array(PBKDF2_SALT_BYTES));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    key,
    PBKDF2_HASH_BYTES * 8,
  );
  return (
    "pbkdf2$" +
    PBKDF2_ITERATIONS +
    "$" +
    bytesToBase64(salt) +
    "$" +
    bytesToBase64(new Uint8Array(bits))
  );
}

async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iters = parseInt(parts[1], 10);
  const salt = base64ToBytes(parts[2]);
  const expected = base64ToBytes(parts[3]);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: iters, hash: "SHA-256" },
    key,
    expected.length * 8,
  );
  const derived = new Uint8Array(bits);
  if (derived.length !== expected.length) return false;
  // Constant-time comparison
  let diff = 0;
  for (let i = 0; i < derived.length; i++) diff |= derived[i] ^ expected[i];
  return diff === 0;
}

function generateToken(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function generateInviteCode(name: string): string {
  const stem = name
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 10) || "COVENANT";
  const suffix = generateToken(2).toUpperCase();
  return stem + "-" + suffix;
}

// ─── Session helper ───────────────────────────────────────────

async function requireChurchSession(
  ctx: QueryCtx | MutationCtx,
  sessionToken: string,
): Promise<Doc<"churches">> {
  const session = await ctx.db
    .query("churchSessions")
    .withIndex("by_token", (q) => q.eq("sessionToken", sessionToken))
    .unique();
  if (!session) throw new Error("Session invalid. Sign in again.");
  if (session.expiresAt < Date.now()) throw new Error("Session expired. Sign in again.");
  const church = await ctx.db.get(session.churchId);
  if (!church) throw new Error("Church not found.");
  return church;
}

// ─── Public auth ──────────────────────────────────────────────

export const signInChurch = mutation({
  args: { email: v.string(), password: v.string() },
  handler: async (ctx, args) => {
    const email = normalizeEmail(args.email);
    const church = await ctx.db
      .query("churches")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    const generic = "That email and password don't match a church account.";
    if (!church) throw new Error(generic);
    const ok = await verifyPassword(args.password, church.passwordHash);
    if (!ok) throw new Error(generic);
    const now = Date.now();
    const sessionToken = generateToken(48);
    await ctx.db.insert("churchSessions", {
      churchId: church._id,
      sessionToken,
      expiresAt: now + SESSION_LIFETIME_MS,
      createdAt: now,
    });
    await ctx.db.patch(church._id, { lastSignInAt: now });
    return { sessionToken };
  },
});

export const signOutChurch = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("churchSessions")
      .withIndex("by_token", (q) => q.eq("sessionToken", args.sessionToken))
      .unique();
    if (session) await ctx.db.delete(session._id);
    return { ok: true };
  },
});

export const getMyChurch = query({
  args: { sessionToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (!args.sessionToken) return null;
    const session = await ctx.db
      .query("churchSessions")
      .withIndex("by_token", (q) => q.eq("sessionToken", args.sessionToken))
      .unique();
    if (!session || session.expiresAt < Date.now()) return null;
    const church = await ctx.db.get(session.churchId);
    if (!church) return null;
    return {
      id: church._id,
      name: church.name,
      email: church.email,
      contactPerson: church.contactPerson ?? "",
      inviteCode: church.inviteCode,
    };
  },
});

// ─── Bootstrap (used to create the first church account) ─────
// Called via an action from a one-time script or the Convex CLI.
// No auth — protected by only being callable through internal tooling.
// Once you've created your first church, you can disable this or add
// an admin secret check.

export const createChurchAccount = action({
  args: {
    name: v.string(),
    email: v.string(),
    password: v.string(),
    contactPerson: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ churchId: Id<"churches">; inviteCode: string }> => {
    const email = normalizeEmail(args.email);
    const passwordHash = await hashPassword(args.password);
    const inviteCode = generateInviteCode(args.name);
    const now = Date.now();
    return await ctx.runMutation(
      // @ts-ignore — internal boundary
      "church:_insertChurch",
      { name: args.name.trim(), email, contactPerson: args.contactPerson?.trim(), passwordHash, inviteCode, now },
    );
  },
});

export const _insertChurch = mutation({
  args: {
    name: v.string(),
    email: v.string(),
    contactPerson: v.optional(v.string()),
    passwordHash: v.string(),
    inviteCode: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("churches")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .unique();
    if (existing) throw new Error("A church with that email already exists.");
    const churchId = await ctx.db.insert("churches", {
      name: args.name,
      email: args.email,
      contactPerson: args.contactPerson,
      passwordHash: args.passwordHash,
      inviteCode: args.inviteCode,
      createdAt: args.now,
    });
    return { churchId, inviteCode: args.inviteCode };
  },
});

// ─── Aggregate reports ────────────────────────────────────────

/**
 * Top-of-dashboard summary. Sums across every org affiliated with
 * this church, and rolls remittances up by month for the trend chart.
 */
export const overview = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const church = await requireChurchSession(ctx, args.sessionToken);
    const affiliated = await ctx.db
      .query("orgs")
      .withIndex("by_church", (q) => q.eq("churchId", church._id))
      .collect();
    const orgIds = affiliated.map((o) => o._id);

    let totalPartners = 0;
    let activePartners = 0;
    let totalClients = 0;
    let totalRemitted = 0;
    let totalOwed = 0;
    // Monthly remittance trend for last 12 months (YYYY-MM keys).
    const now = new Date();
    const monthKeys: string[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      monthKeys.push(d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"));
    }
    const remitByMonth: Record<string, number> = Object.fromEntries(monthKeys.map((k) => [k, 0]));

    for (const orgId of orgIds) {
      const [partners, clients, logs, obls] = await Promise.all([
        ctx.db.query("partners").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
        ctx.db.query("clients").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
        ctx.db.query("remittanceLogs").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
        ctx.db.query("obligations").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
      ]);
      totalPartners += partners.length;
      activePartners += partners.filter((p) => p.st === "active").length;
      totalClients += clients.length;
      for (const l of logs) {
        totalRemitted += l.am || 0;
        const k = (l.dt || "").slice(0, 7);
        if (k && remitByMonth[k] != null) remitByMonth[k] += l.am || 0;
      }
      for (const o of obls) {
        if (!o.archived) totalOwed += o.bal || 0;
      }
    }

    return {
      churchName: church.name,
      inviteCode: church.inviteCode,
      affiliatedCount: affiliated.length,
      totalPartners,
      activePartners,
      totalClients,
      totalRemitted,
      totalOwed,
      remitByMonth: monthKeys.map((k) => ({ month: k, value: remitByMonth[k] })),
    };
  },
});

/**
 * Table of every affiliated Home Office with per-HO topline numbers.
 * Church UI expands any row to load fuller detail via homeOfficeDetail.
 */
export const byHomeOffice = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const church = await requireChurchSession(ctx, args.sessionToken);
    const affiliated = await ctx.db
      .query("orgs")
      .withIndex("by_church", (q) => q.eq("churchId", church._id))
      .collect();
    const rows = [];
    for (const org of affiliated) {
      const [partners, clients, logs, obls] = await Promise.all([
        ctx.db.query("partners").withIndex("by_org", (q) => q.eq("orgId", org._id)).collect(),
        ctx.db.query("clients").withIndex("by_org", (q) => q.eq("orgId", org._id)).collect(),
        ctx.db.query("remittanceLogs").withIndex("by_org", (q) => q.eq("orgId", org._id)).collect(),
        ctx.db.query("obligations").withIndex("by_org", (q) => q.eq("orgId", org._id)).collect(),
      ]);
      const totalRemitted = logs.reduce((a, l) => a + (l.am || 0), 0);
      const totalOwed = obls.filter((o) => !o.archived).reduce((a, o) => a + (o.bal || 0), 0);
      rows.push({
        orgId: org._id,
        name: org.name,
        contactEmail: null, // could add later — CEO's email
        activePartners: partners.filter((p) => p.st === "active").length,
        totalPartners: partners.length,
        activeClients: clients.filter((c) => c.st === "active").length,
        totalClients: clients.length,
        totalRemitted,
        totalOwed,
        affiliatedAt: org.churchAffiliatedAt ?? org.createdAt,
      });
    }
    rows.sort((a, b) => a.name.localeCompare(b.name));
    return rows;
  },
});

/**
 * Expanded detail for one Home Office — personnel + ministry
 * participation. Individual salary and payment amounts are
 * intentionally NOT returned; the church sees who's under its
 * umbrella and how the ministry team is doing, not private financial
 * detail on individuals.
 */
export const homeOfficeDetail = query({
  args: { sessionToken: v.string(), orgId: v.id("orgs") },
  handler: async (ctx, args) => {
    const church = await requireChurchSession(ctx, args.sessionToken);
    const org = await ctx.db.get(args.orgId);
    if (!org || org.churchId !== church._id) {
      throw new Error("Home Office not found or not affiliated with your church.");
    }

    const [partners, clients, attendance, logs] = await Promise.all([
      ctx.db.query("partners").withIndex("by_org", (q) => q.eq("orgId", org._id)).collect(),
      ctx.db.query("clients").withIndex("by_org", (q) => q.eq("orgId", org._id)).collect(),
      ctx.db.query("attendance").withIndex("by_org_partner_date", (q) => q.eq("orgId", org._id)).collect(),
      ctx.db.query("remittanceLogs").withIndex("by_org", (q) => q.eq("orgId", org._id)).collect(),
    ]);

    // Compute this-month devotion + attendance rates, per partner
    // and team overall. Weekdays only for attendance; every logged
    // day counts for devotion.
    const now = new Date();
    const monthKey = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const today = now.toISOString().slice(0, 10);
    const monthDays: string[] = [];
    const workdaysThisMonth: string[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = monthKey + "-" + String(d).padStart(2, "0");
      if (ds > today) continue;
      monthDays.push(ds);
      const dow = new Date(now.getFullYear(), now.getMonth(), d).getDay();
      if (dow >= 1 && dow <= 5) workdaysThisMonth.push(ds);
    }

    // Index attendance by partnerLegacyId + date for quick lookup.
    const attByPartnerDate = new Map<string, typeof attendance[number]>();
    for (const r of attendance) {
      if (r.partnerLegacyId != null && r.date) {
        attByPartnerDate.set(r.partnerLegacyId + ":" + r.date, r);
      }
    }

    const partnerRows = partners.map((p) => {
      let devTotal = 0, devLogged = 0;
      let attTotal = 0, attLogged = 0;
      for (const ds of monthDays) {
        const r = attByPartnerDate.get(p.legacyId + ":" + ds);
        if (r && r.dv) {
          devTotal++;
          if (r.dv === "yes") devLogged++;
        }
      }
      for (const ds of workdaysThisMonth) {
        const r = attByPartnerDate.get(p.legacyId + ":" + ds);
        // "was active on this date" — mirror /app.html wasActiveOn
        const activeOn =
          p.st === "active" ||
          (p.deactivatedAt != null && ds <= p.deactivatedAt);
        if (!activeOn) continue;
        attTotal++;
        if (r && r.st !== "absent" && r.st !== "nowork") attLogged++;
      }
      return {
        legacyId: p.legacyId,
        name: (p.fn || "") + " " + (p.ln || ""),
        role: p.ro || "",
        status: p.st,
        devotionPct: devTotal > 0 ? Math.round((devLogged / devTotal) * 100) : null,
        devotionDays: devLogged,
        devotionDaysLogged: devTotal,
        attendancePct: attTotal > 0 ? Math.round((attLogged / attTotal) * 100) : null,
      };
    });

    // Team overall rates.
    let devT = 0, devL = 0, attT = 0, attL = 0;
    for (const row of partnerRows) {
      if (row.devotionPct != null) {
        devT += row.devotionDaysLogged;
        devL += row.devotionDays;
      }
    }
    for (const ds of workdaysThisMonth) {
      for (const p of partners) {
        const activeOn =
          p.st === "active" ||
          (p.deactivatedAt != null && ds <= p.deactivatedAt);
        if (!activeOn) continue;
        attT++;
        const r = attByPartnerDate.get(p.legacyId + ":" + ds);
        if (r && r.st !== "absent" && r.st !== "nowork") attL++;
      }
    }
    const teamDevotionPct = devT > 0 ? Math.round((devL / devT) * 100) : null;
    const teamAttendancePct = attT > 0 ? Math.round((attL / attT) * 100) : null;

    const clientRows = clients.map((c) => ({
      legacyId: c.legacyId,
      name: c.nm,
      type: c.ty || "—",              // 'full-time' | 'part-time' | 'gig'
      status: c.st,
    }));

    // Last 5 remittances (compact list for the expanded row).
    const recentRemits = logs
      .slice()
      .sort((a, b) => (b.dt || "").localeCompare(a.dt || ""))
      .slice(0, 5)
      .map((l) => ({ dt: l.dt, amount: l.am, mode: l.mo || "—", reference: l.rf || "" }));

    return {
      orgId: org._id,
      orgName: org.name,
      partners: partnerRows,
      clients: clientRows,
      teamDevotionPct,
      teamAttendancePct,
      recentRemits,
      workdaysThisMonth: workdaysThisMonth.length,
      monthKey,
    };
  },
});

// ─── Cross-HO tab queries ───────────────────────────────────
// Small helper — reuse the church's affiliated orgs across queries
// so we're not rewriting the fetch three times.
async function affiliatedOrgIds(
  ctx: QueryCtx,
  churchId: Id<"churches">,
): Promise<Array<Doc<"orgs">>> {
  return await ctx.db
    .query("orgs")
    .withIndex("by_church", (q) => q.eq("churchId", churchId))
    .collect();
}

/**
 * All clients across every affiliated Home Office. Church sees who's
 * being served in each ministry umbrella + their engagement type
 * (full-time / part-time / gig). No payment amounts.
 */
export const allClients = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const church = await requireChurchSession(ctx, args.sessionToken);
    const orgs = await affiliatedOrgIds(ctx, church._id);
    const rows: Array<{
      orgId: Id<"orgs">;
      orgName: string;
      clientId: number | undefined;
      name: string;
      type: string;
      status: string;
    }> = [];
    for (const org of orgs) {
      const clients = await ctx.db
        .query("clients")
        .withIndex("by_org", (q) => q.eq("orgId", org._id))
        .collect();
      for (const c of clients) {
        rows.push({
          orgId: org._id,
          orgName: org.name,
          clientId: c.legacyId,
          name: c.nm,
          type: c.ty || "—",
          status: c.st,
        });
      }
    }
    rows.sort((a, b) =>
      a.orgName.localeCompare(b.orgName) ||
      a.name.localeCompare(b.name),
    );
    return rows;
  },
});

/**
 * All obligations across every affiliated Home Office. Obligations
 * are already an aggregate concept (what the HO owes to the church
 * or to partners for a given period) so church visibility is
 * appropriate. Partner-tithe rows include partner names since the
 * church cares who's remitting.
 */
export const allObligations = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const church = await requireChurchSession(ctx, args.sessionToken);
    const orgs = await affiliatedOrgIds(ctx, church._id);
    const rows: Array<{
      orgId: Id<"orgs">;
      orgName: string;
      key: string;
      type: string;
      label: string;
      period: string;
      total: number;
      balance: number;
      status: string;
      partnerName: string | null;
      clientName: string | null;
      archived: boolean;
    }> = [];
    for (const org of orgs) {
      const [obls, partners, clients] = await Promise.all([
        ctx.db.query("obligations").withIndex("by_org", (q) => q.eq("orgId", org._id)).collect(),
        ctx.db.query("partners").withIndex("by_org", (q) => q.eq("orgId", org._id)).collect(),
        ctx.db.query("clients").withIndex("by_org", (q) => q.eq("orgId", org._id)).collect(),
      ]);
      const partnerByLegacy = new Map(partners.map((p) => [p.legacyId, p]));
      const clientByLegacy = new Map(clients.map((c) => [c.legacyId, c]));
      for (const o of obls) {
        const p = o.ptnId != null ? partnerByLegacy.get(o.ptnId) : undefined;
        const c = o.ci != null ? clientByLegacy.get(o.ci) : undefined;
        const status = o.archived
          ? "archived"
          : o.bal <= 0.01
          ? "remitted"
          : o.bal < o.tot - 0.01
          ? "partial"
          : "pending";
        rows.push({
          orgId: org._id,
          orgName: org.name,
          key: o.key ?? String(o._id),
          type: o.ty,
          label: o.lb,
          period: o.pe ?? "",
          total: o.tot,
          balance: o.bal,
          status,
          partnerName: p ? `${p.fn} ${p.ln}` : null,
          clientName: c ? c.nm : null,
          archived: !!o.archived,
        });
      }
    }
    rows.sort((a, b) => {
      const s = (b.period || "").localeCompare(a.period || "");
      if (s !== 0) return s;
      return a.orgName.localeCompare(b.orgName);
    });
    return rows;
  },
});

/**
 * Ministry participation across every affiliated Home Office for a
 * given month. Devotion, Sunday service, and Church activities each
 * yield a team-average %. Per-partner breakdown is available inside
 * each row so the church can drill in.
 */
export const health = query({
  args: {
    sessionToken: v.string(),
    monthKey: v.optional(v.string()), // "YYYY-MM"; defaults to current month
  },
  handler: async (ctx, args) => {
    const church = await requireChurchSession(ctx, args.sessionToken);
    const orgs = await affiliatedOrgIds(ctx, church._id);

    // Resolve the month bounds.
    const now = new Date();
    const monthKey =
      args.monthKey || now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
    const [y, m] = monthKey.split("-").map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const todayStr = now.toISOString().slice(0, 10);
    const monthDays: string[] = [];
    const sundaysInMonth: string[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = monthKey + "-" + String(d).padStart(2, "0");
      if (ds > todayStr) continue;
      monthDays.push(ds);
      const dow = new Date(y, m - 1, d).getDay();
      if (dow === 0) sundaysInMonth.push(ds);
    }

    const rows: Array<{
      orgId: Id<"orgs">;
      orgName: string;
      monthKey: string;
      activePartners: number;
      devotionPct: number | null;
      sundayServicePct: number | null;
      churchActivitiesPct: number | null;
      partners: Array<{
        legacyId: number | undefined;
        name: string;
        role: string;
        status: string;
        devotionPct: number | null;
        sundayServicePct: number | null;
        churchActivitiesPct: number | null;
      }>;
    }> = [];

    for (const org of orgs) {
      const [partners, attendance] = await Promise.all([
        ctx.db.query("partners").withIndex("by_org", (q) => q.eq("orgId", org._id)).collect(),
        ctx.db.query("attendance").withIndex("by_org_partner_date", (q) => q.eq("orgId", org._id)).collect(),
      ]);
      const attByPartnerDate = new Map<string, typeof attendance[number]>();
      for (const r of attendance) {
        if (r.partnerLegacyId != null && r.date) {
          attByPartnerDate.set(r.partnerLegacyId + ":" + r.date, r);
        }
      }
      let teamDevT = 0, teamDevL = 0;
      let teamSsT = 0, teamSsL = 0;
      let teamCaT = 0, teamCaL = 0;
      const partnerRows = partners.map((p) => {
        let devT = 0, devL = 0;
        let ssT = 0, ssL = 0;
        let caT = 0, caL = 0;
        for (const ds of monthDays) {
          const activeOn =
            p.st === "active" ||
            (p.deactivatedAt != null && ds <= p.deactivatedAt);
          if (!activeOn) continue;
          const r = attByPartnerDate.get(p.legacyId + ":" + ds);
          if (r?.dv) {
            devT++;
            if (r.dv === "yes") devL++;
          }
          if (r?.ca) {
            caT++;
            if (r.ca === "yes") caL++;
          }
        }
        for (const ds of sundaysInMonth) {
          const activeOn =
            p.st === "active" ||
            (p.deactivatedAt != null && ds <= p.deactivatedAt);
          if (!activeOn) continue;
          const r = attByPartnerDate.get(p.legacyId + ":" + ds);
          if (r?.ss) {
            ssT++;
            if (r.ss === "yes") ssL++;
          }
        }
        teamDevT += devT;
        teamDevL += devL;
        teamSsT += ssT;
        teamSsL += ssL;
        teamCaT += caT;
        teamCaL += caL;
        return {
          legacyId: p.legacyId,
          name: `${p.fn ?? ""} ${p.ln ?? ""}`.trim(),
          role: p.ro ?? "",
          status: p.st,
          devotionPct: devT > 0 ? Math.round((devL / devT) * 100) : null,
          sundayServicePct: ssT > 0 ? Math.round((ssL / ssT) * 100) : null,
          churchActivitiesPct: caT > 0 ? Math.round((caL / caT) * 100) : null,
        };
      });
      rows.push({
        orgId: org._id,
        orgName: org.name,
        monthKey,
        activePartners: partners.filter((p) => p.st === "active").length,
        devotionPct: teamDevT > 0 ? Math.round((teamDevL / teamDevT) * 100) : null,
        sundayServicePct: teamSsT > 0 ? Math.round((teamSsL / teamSsT) * 100) : null,
        churchActivitiesPct: teamCaT > 0 ? Math.round((teamCaL / teamCaT) * 100) : null,
        partners: partnerRows,
      });
    }
    rows.sort((a, b) => a.orgName.localeCompare(b.orgName));
    return rows;
  },
});
