/**
 * Church finances — verification of HO remittances, direct-recorded
 * income (from non-Covenant people), church expenses, and the
 * higher-church tithe ledger.
 *
 * All queries + mutations require a church session — HO users never
 * see these functions.
 */
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx, MutationCtx } from "./_generated/server";

async function requireChurch(
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

async function affiliatedOrgs(ctx: QueryCtx, churchId: Id<"churches">) {
  return await ctx.db
    .query("orgs")
    .withIndex("by_church", (q) => q.eq("churchId", churchId))
    .collect();
}

// ─── HO REMITTANCE VERIFICATION ──────────────────────────────

/**
 * All HO remittances across affiliated Home Offices with the church's
 * verification status. Filter is client-side to keep this cheap.
 */
export const listHoRemittances = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const church = await requireChurch(ctx, args.sessionToken);
    const orgs = await affiliatedOrgs(ctx, church._id);
    const rows: Array<{
      id: Id<"remittanceLogs">;
      orgId: Id<"orgs">;
      orgName: string;
      date: string;
      amount: number;
      mode: string;
      by: string;
      reference: string;
      status: "pending" | "verified" | "disputed";
      verifiedAt: number | null;
      disputedReason: string | null;
    }> = [];
    for (const org of orgs) {
      const logs = await ctx.db
        .query("remittanceLogs")
        .withIndex("by_org", (q) => q.eq("orgId", org._id))
        .collect();
      for (const l of logs) {
        // Rows without a status default to 'pending' so pre-feature
        // data doesn't disappear from the verification queue.
        const status = l.verificationStatus ?? "pending";
        rows.push({
          id: l._id,
          orgId: org._id,
          orgName: org.name,
          date: l.dt,
          amount: l.am,
          mode: l.mo ?? "",
          by: l.by ?? "",
          reference: l.rf ?? "",
          status,
          verifiedAt: l.verifiedAt ?? null,
          disputedReason: l.disputedReason ?? null,
        });
      }
    }
    rows.sort((a, b) => b.date.localeCompare(a.date));
    return rows;
  },
});

export const verifyHoRemittance = mutation({
  args: { sessionToken: v.string(), remittanceId: v.id("remittanceLogs") },
  handler: async (ctx, args) => {
    const church = await requireChurch(ctx, args.sessionToken);
    const rem = await ctx.db.get(args.remittanceId);
    if (!rem) throw new Error("Remittance not found.");
    // Guard: the remittance must belong to a HO affiliated with this church.
    const org = await ctx.db.get(rem.orgId);
    if (!org || org.churchId !== church._id) {
      throw new Error("Remittance is not from an affiliated Home Office.");
    }
    await ctx.db.patch(args.remittanceId, {
      verificationStatus: "verified",
      verifiedAt: Date.now(),
      verifiedByChurchId: church._id,
      disputedReason: undefined,
    });
    return { ok: true };
  },
});

export const disputeHoRemittance = mutation({
  args: {
    sessionToken: v.string(),
    remittanceId: v.id("remittanceLogs"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const church = await requireChurch(ctx, args.sessionToken);
    const rem = await ctx.db.get(args.remittanceId);
    if (!rem) throw new Error("Remittance not found.");
    const org = await ctx.db.get(rem.orgId);
    if (!org || org.churchId !== church._id) {
      throw new Error("Remittance is not from an affiliated Home Office.");
    }
    const reason = args.reason.trim();
    if (!reason) throw new Error("Please enter a reason for the dispute.");
    await ctx.db.patch(args.remittanceId, {
      verificationStatus: "disputed",
      disputedReason: reason,
      verifiedAt: undefined,
      verifiedByChurchId: undefined,
    });
    return { ok: true };
  },
});

export const resetHoRemittanceStatus = mutation({
  args: { sessionToken: v.string(), remittanceId: v.id("remittanceLogs") },
  handler: async (ctx, args) => {
    const church = await requireChurch(ctx, args.sessionToken);
    const rem = await ctx.db.get(args.remittanceId);
    if (!rem) throw new Error("Remittance not found.");
    const org = await ctx.db.get(rem.orgId);
    if (!org || org.churchId !== church._id) {
      throw new Error("Remittance is not from an affiliated Home Office.");
    }
    await ctx.db.patch(args.remittanceId, {
      verificationStatus: "pending",
      verifiedAt: undefined,
      verifiedByChurchId: undefined,
      disputedReason: undefined,
    });
    return { ok: true };
  },
});

// ─── DIRECT INCOME (church-recorded) ─────────────────────────

export const listDirectIncome = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const church = await requireChurch(ctx, args.sessionToken);
    const rows = await ctx.db
      .query("churchDirectRemittances")
      .withIndex("by_church", (q) => q.eq("churchId", church._id))
      .collect();
    rows.sort((a, b) => b.date.localeCompare(a.date));
    return rows.map((r) => ({
      id: r._id,
      date: r.date,
      amount: r.amount,
      type: r.type,
      giverName: r.giverName ?? "",
      giverContact: r.giverContact ?? "",
      mode: r.mode ?? "",
      note: r.note ?? "",
    }));
  },
});

export const createDirectIncome = mutation({
  args: {
    sessionToken: v.string(),
    date: v.string(),
    amount: v.number(),
    type: v.union(
      v.literal("firstfruit"),
      v.literal("tithe"),
      v.literal("church-project"),
      v.literal("offering"),
    ),
    giverName: v.optional(v.string()),
    giverContact: v.optional(v.string()),
    mode: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const church = await requireChurch(ctx, args.sessionToken);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) throw new Error("Date must be YYYY-MM-DD.");
    if (args.amount <= 0) throw new Error("Amount must be greater than zero.");
    const id = await ctx.db.insert("churchDirectRemittances", {
      churchId: church._id,
      date: args.date,
      amount: args.amount,
      type: args.type,
      giverName: args.giverName?.trim() || undefined,
      giverContact: args.giverContact?.trim() || undefined,
      mode: args.mode?.trim() || undefined,
      note: args.note?.trim() || undefined,
      createdAt: Date.now(),
    });
    return { id };
  },
});

export const deleteDirectIncome = mutation({
  args: { sessionToken: v.string(), id: v.id("churchDirectRemittances") },
  handler: async (ctx, args) => {
    const church = await requireChurch(ctx, args.sessionToken);
    const row = await ctx.db.get(args.id);
    if (!row || row.churchId !== church._id) throw new Error("Entry not found.");
    await ctx.db.delete(args.id);
    return { ok: true };
  },
});

// ─── EXPENSES ────────────────────────────────────────────────

export const listExpenses = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const church = await requireChurch(ctx, args.sessionToken);
    const rows = await ctx.db
      .query("churchExpenses")
      .withIndex("by_church", (q) => q.eq("churchId", church._id))
      .collect();
    rows.sort((a, b) => b.date.localeCompare(a.date));
    return rows.map((r) => ({
      id: r._id,
      date: r.date,
      amount: r.amount,
      category: r.category,
      description: r.description ?? "",
      note: r.note ?? "",
    }));
  },
});

export const createExpense = mutation({
  args: {
    sessionToken: v.string(),
    date: v.string(),
    amount: v.number(),
    category: v.string(),
    description: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const church = await requireChurch(ctx, args.sessionToken);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) throw new Error("Date must be YYYY-MM-DD.");
    if (args.amount <= 0) throw new Error("Amount must be greater than zero.");
    const category = args.category.trim();
    if (!category) throw new Error("Category is required.");
    const id = await ctx.db.insert("churchExpenses", {
      churchId: church._id,
      date: args.date,
      amount: args.amount,
      category,
      description: args.description?.trim() || undefined,
      note: args.note?.trim() || undefined,
      createdAt: Date.now(),
    });
    return { id };
  },
});

export const deleteExpense = mutation({
  args: { sessionToken: v.string(), id: v.id("churchExpenses") },
  handler: async (ctx, args) => {
    const church = await requireChurch(ctx, args.sessionToken);
    const row = await ctx.db.get(args.id);
    if (!row || row.churchId !== church._id) throw new Error("Expense not found.");
    await ctx.db.delete(args.id);
    return { ok: true };
  },
});

// ─── HIGHER-CHURCH ───────────────────────────────────────────

export const getHigherChurchSettings = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const church = await requireChurch(ctx, args.sessionToken);
    return {
      rate: church.higherChurchTitheRate ?? 10,
      name: church.higherChurchName ?? "",
    };
  },
});

export const updateHigherChurchSettings = mutation({
  args: {
    sessionToken: v.string(),
    rate: v.number(),
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const church = await requireChurch(ctx, args.sessionToken);
    if (args.rate < 0 || args.rate > 100) throw new Error("Rate must be between 0 and 100.");
    await ctx.db.patch(church._id, {
      higherChurchTitheRate: args.rate,
      higherChurchName: args.name?.trim() || undefined,
    });
    return { ok: true };
  },
});

export const listHigherChurchRemittances = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const church = await requireChurch(ctx, args.sessionToken);
    const rows = await ctx.db
      .query("higherChurchRemittances")
      .withIndex("by_church", (q) => q.eq("churchId", church._id))
      .collect();
    rows.sort((a, b) => b.date.localeCompare(a.date));
    return rows.map((r) => ({
      id: r._id,
      date: r.date,
      amount: r.amount,
      reference: r.reference ?? "",
      note: r.note ?? "",
    }));
  },
});

export const createHigherChurchRemittance = mutation({
  args: {
    sessionToken: v.string(),
    date: v.string(),
    amount: v.number(),
    reference: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const church = await requireChurch(ctx, args.sessionToken);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) throw new Error("Date must be YYYY-MM-DD.");
    if (args.amount <= 0) throw new Error("Amount must be greater than zero.");
    const id = await ctx.db.insert("higherChurchRemittances", {
      churchId: church._id,
      date: args.date,
      amount: args.amount,
      reference: args.reference?.trim() || undefined,
      note: args.note?.trim() || undefined,
      createdAt: Date.now(),
    });
    return { id };
  },
});

export const deleteHigherChurchRemittance = mutation({
  args: { sessionToken: v.string(), id: v.id("higherChurchRemittances") },
  handler: async (ctx, args) => {
    const church = await requireChurch(ctx, args.sessionToken);
    const row = await ctx.db.get(args.id);
    if (!row || row.churchId !== church._id) throw new Error("Remittance not found.");
    await ctx.db.delete(args.id);
    return { ok: true };
  },
});

// ─── AGGREGATE OVERVIEW ─────────────────────────────────────

/**
 * Roll-up used by the Finances tab dashboard. Computes:
 *   - Total VERIFIED tithes across all sources (HO + direct)
 *   - Amount owed to the higher church (rate × verified tithes)
 *   - Amount already remitted to the higher church
 *   - Outstanding balance
 *   - Direct income + expense totals month-to-date
 *   - Pending HO remit count (queue depth)
 */
export const overview = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const church = await requireChurch(ctx, args.sessionToken);
    const orgs = await affiliatedOrgs(ctx, church._id);

    // HO remits, split by verification status. Tithe / firstfruit /
    // church-project / partner-tithe split via poolAl summary.
    let hoPending = 0;
    let hoPendingCount = 0;
    let hoVerified = 0;
    let hoDisputed = 0;
    let verifiedTithe = 0;
    let verifiedFirstfruit = 0;
    let verifiedChurchProject = 0;
    let verifiedPartnerTithe = 0;
    for (const org of orgs) {
      const logs = await ctx.db
        .query("remittanceLogs")
        .withIndex("by_org", (q) => q.eq("orgId", org._id))
        .collect();
      for (const l of logs) {
        const status = l.verificationStatus ?? "pending";
        if (status === "pending") {
          hoPending += l.am;
          hoPendingCount++;
        } else if (status === "verified") {
          hoVerified += l.am;
          // Split by pool if the HO recorded a poolAl breakdown.
          for (const p of (l.poolAl ?? [])) {
            const amt = p.am ?? 0;
            switch (p.ty) {
              case "tithe": verifiedTithe += amt; break;
              case "firstfruit": verifiedFirstfruit += amt; break;
              case "church": verifiedChurchProject += amt; break;
              case "partner-tithe": verifiedPartnerTithe += amt; break;
            }
          }
        } else if (status === "disputed") {
          hoDisputed += l.am;
        }
      }
    }

    // Direct income.
    const direct = await ctx.db
      .query("churchDirectRemittances")
      .withIndex("by_church", (q) => q.eq("churchId", church._id))
      .collect();
    let directTithe = 0;
    let directFirstfruit = 0;
    let directChurchProject = 0;
    let directOffering = 0;
    for (const r of direct) {
      switch (r.type) {
        case "tithe": directTithe += r.amount; break;
        case "firstfruit": directFirstfruit += r.amount; break;
        case "church-project": directChurchProject += r.amount; break;
        case "offering": directOffering += r.amount; break;
      }
    }

    // Expenses.
    const expenses = await ctx.db
      .query("churchExpenses")
      .withIndex("by_church", (q) => q.eq("churchId", church._id))
      .collect();
    const totalExpenses = expenses.reduce((a, e) => a + e.amount, 0);

    // Higher-church.
    const higherRemits = await ctx.db
      .query("higherChurchRemittances")
      .withIndex("by_church", (q) => q.eq("churchId", church._id))
      .collect();
    const higherRemitted = higherRemits.reduce((a, r) => a + r.amount, 0);

    const rate = church.higherChurchTitheRate ?? 10;
    const totalVerifiedTithe = verifiedTithe + directTithe;
    const higherOwed = totalVerifiedTithe * (rate / 100);
    const higherBalance = Math.max(0, higherOwed - higherRemitted);

    return {
      // Verification queue
      hoPending,
      hoPendingCount,
      hoVerified,
      hoDisputed,
      // By pool
      verifiedTithe,
      verifiedFirstfruit,
      verifiedChurchProject,
      verifiedPartnerTithe,
      directTithe,
      directFirstfruit,
      directChurchProject,
      directOffering,
      // Combined totals
      totalVerifiedIncome:
        hoVerified + directTithe + directFirstfruit + directChurchProject + directOffering,
      totalDirectIncome: directTithe + directFirstfruit + directChurchProject + directOffering,
      totalExpenses,
      // Higher church
      higherChurchName: church.higherChurchName ?? "",
      higherChurchRate: rate,
      higherOwed,
      higherRemitted,
      higherBalance,
    };
  },
});
