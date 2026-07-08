/**
 * Life groups — configured by the church, assigned per-partner by
 * each affiliated Home Office.
 *
 * Church-side (church session)
 *   - list / create / update / remove / getWithRoster
 *   - addExternalMember / removeExternalMember
 *   - overview: summary counts for the church dashboard
 *
 * HO-side (user session)
 *   - listForMyChurch: HO's partner form calls this to populate the
 *     life-group dropdown from the affiliated church. Returns empty
 *     array if the HO isn't affiliated.
 *
 * partner.lifeGroupId is the source of truth for partner assignment.
 * lifeGroupMembers rows are created by the CEO's sync (via the
 * partners diff mutation, which mirrors any lifeGroupId change into
 * lifeGroupMembers so the church can query membership without
 * scanning every partner in every HO).
 */
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { loadSession } from "./auth";

// ─── Church session helper (mirrors church.ts's) ────────────
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

// ─── CHURCH: list + CRUD ─────────────────────────────────────

export const list = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const church = await requireChurch(ctx, args.sessionToken);
    const groups = await ctx.db
      .query("lifeGroups")
      .withIndex("by_church", (q) => q.eq("churchId", church._id))
      .collect();
    // Compute member counts + partner/external split per group.
    const rows = [];
    for (const g of groups) {
      const members = await ctx.db
        .query("lifeGroupMembers")
        .withIndex("by_lifeGroup", (q) => q.eq("lifeGroupId", g._id))
        .collect();
      rows.push({
        id: g._id,
        name: g.name,
        leader: g.leader ?? "",
        meetingDay: g.meetingDay ?? "",
        meetingTime: g.meetingTime ?? "",
        description: g.description ?? "",
        totalMembers: members.length,
        partnerCount: members.filter((m) => m.kind === "partner").length,
        externalCount: members.filter((m) => m.kind === "external").length,
        createdAt: g.createdAt,
      });
    }
    rows.sort((a, b) => a.name.localeCompare(b.name));
    return rows;
  },
});

export const create = mutation({
  args: {
    sessionToken: v.string(),
    name: v.string(),
    leader: v.optional(v.string()),
    meetingDay: v.optional(v.string()),
    meetingTime: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const church = await requireChurch(ctx, args.sessionToken);
    const name = args.name.trim();
    if (!name) throw new Error("Life group name is required.");
    const id = await ctx.db.insert("lifeGroups", {
      churchId: church._id,
      name,
      leader: args.leader?.trim() || undefined,
      meetingDay: args.meetingDay?.trim() || undefined,
      meetingTime: args.meetingTime?.trim() || undefined,
      description: args.description?.trim() || undefined,
      createdAt: Date.now(),
    });
    return { id };
  },
});

export const update = mutation({
  args: {
    sessionToken: v.string(),
    id: v.id("lifeGroups"),
    name: v.optional(v.string()),
    leader: v.optional(v.string()),
    meetingDay: v.optional(v.string()),
    meetingTime: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const church = await requireChurch(ctx, args.sessionToken);
    const group = await ctx.db.get(args.id);
    if (!group || group.churchId !== church._id) {
      throw new Error("Life group not found.");
    }
    const patch: Partial<Doc<"lifeGroups">> = {};
    if (args.name != null) {
      const name = args.name.trim();
      if (!name) throw new Error("Name cannot be blank.");
      patch.name = name;
    }
    if (args.leader != null) patch.leader = args.leader.trim() || undefined;
    if (args.meetingDay != null) patch.meetingDay = args.meetingDay.trim() || undefined;
    if (args.meetingTime != null) patch.meetingTime = args.meetingTime.trim() || undefined;
    if (args.description != null) patch.description = args.description.trim() || undefined;
    await ctx.db.patch(args.id, patch);
    return { ok: true };
  },
});

export const remove = mutation({
  args: { sessionToken: v.string(), id: v.id("lifeGroups") },
  handler: async (ctx, args) => {
    const church = await requireChurch(ctx, args.sessionToken);
    const group = await ctx.db.get(args.id);
    if (!group || group.churchId !== church._id) {
      throw new Error("Life group not found.");
    }
    // Remove members rows first, then the group itself. Any partner
    // whose partners.lifeGroupId still points to this group gets
    // detached implicitly on next sync (partner query silently
    // returns null for a missing life group).
    const members = await ctx.db
      .query("lifeGroupMembers")
      .withIndex("by_lifeGroup", (q) => q.eq("lifeGroupId", args.id))
      .collect();
    for (const m of members) await ctx.db.delete(m._id);
    // Clear the reference from any partner that still holds it.
    const partners = await ctx.db.query("partners").collect();
    for (const p of partners) {
      if (p.lifeGroupId === args.id) {
        await ctx.db.patch(p._id, { lifeGroupId: undefined });
      }
    }
    await ctx.db.delete(args.id);
    return { ok: true };
  },
});

// ─── CHURCH: roster for one group ───────────────────────────

export const getWithRoster = query({
  args: { sessionToken: v.string(), id: v.id("lifeGroups") },
  handler: async (ctx, args) => {
    const church = await requireChurch(ctx, args.sessionToken);
    const group = await ctx.db.get(args.id);
    if (!group || group.churchId !== church._id) {
      throw new Error("Life group not found.");
    }
    const members = await ctx.db
      .query("lifeGroupMembers")
      .withIndex("by_lifeGroup", (q) => q.eq("lifeGroupId", args.id))
      .collect();
    // Split into partners (resolve name via the partner row) and external.
    const partners: Array<{
      memberId: Id<"lifeGroupMembers">;
      orgId: Id<"orgs">;
      orgName: string;
      partnerLegacyId: number;
      name: string;
      role: string;
      status: string;
    }> = [];
    const externals: Array<{
      memberId: Id<"lifeGroupMembers">;
      name: string;
      contact: string;
      addedAt: number;
    }> = [];
    for (const m of members) {
      if (m.kind === "partner" && m.orgId != null && m.partnerLegacyId != null) {
        const p = await ctx.db
          .query("partners")
          .withIndex("by_org_legacyId", (q) =>
            q.eq("orgId", m.orgId!).eq("legacyId", m.partnerLegacyId!),
          )
          .unique();
        const org = await ctx.db.get(m.orgId);
        if (p && org) {
          partners.push({
            memberId: m._id,
            orgId: m.orgId,
            orgName: org.name,
            partnerLegacyId: m.partnerLegacyId,
            name: `${p.fn} ${p.ln}`.trim(),
            role: p.ro ?? "",
            status: p.st,
          });
        }
      } else if (m.kind === "external") {
        externals.push({
          memberId: m._id,
          name: m.externalName ?? "—",
          contact: m.externalContact ?? "",
          addedAt: m.addedAt,
        });
      }
    }
    partners.sort((a, b) =>
      a.orgName.localeCompare(b.orgName) || a.name.localeCompare(b.name),
    );
    externals.sort((a, b) => a.name.localeCompare(b.name));
    return {
      id: group._id,
      name: group.name,
      leader: group.leader ?? "",
      meetingDay: group.meetingDay ?? "",
      meetingTime: group.meetingTime ?? "",
      description: group.description ?? "",
      partners,
      externals,
    };
  },
});

export const addExternalMember = mutation({
  args: {
    sessionToken: v.string(),
    lifeGroupId: v.id("lifeGroups"),
    name: v.string(),
    contact: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const church = await requireChurch(ctx, args.sessionToken);
    const group = await ctx.db.get(args.lifeGroupId);
    if (!group || group.churchId !== church._id) {
      throw new Error("Life group not found.");
    }
    const name = args.name.trim();
    if (!name) throw new Error("Name is required.");
    const id = await ctx.db.insert("lifeGroupMembers", {
      lifeGroupId: args.lifeGroupId,
      kind: "external",
      externalName: name,
      externalContact: args.contact?.trim() || undefined,
      addedAt: Date.now(),
    });
    return { id };
  },
});

export const removeExternalMember = mutation({
  args: { sessionToken: v.string(), memberId: v.id("lifeGroupMembers") },
  handler: async (ctx, args) => {
    const church = await requireChurch(ctx, args.sessionToken);
    const member = await ctx.db.get(args.memberId);
    if (!member) throw new Error("Member not found.");
    if (member.kind !== "external") {
      throw new Error("Partner assignments are managed by the Home Office. Have the HO CEO unassign them from the partner form.");
    }
    const group = await ctx.db.get(member.lifeGroupId);
    if (!group || group.churchId !== church._id) {
      throw new Error("Life group not found.");
    }
    await ctx.db.delete(args.memberId);
    return { ok: true };
  },
});

// ─── CHURCH: dashboard summary ──────────────────────────────

export const overview = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const church = await requireChurch(ctx, args.sessionToken);
    const groups = await ctx.db
      .query("lifeGroups")
      .withIndex("by_church", (q) => q.eq("churchId", church._id))
      .collect();
    let partnerMembers = 0;
    let externalMembers = 0;
    for (const g of groups) {
      const members = await ctx.db
        .query("lifeGroupMembers")
        .withIndex("by_lifeGroup", (q) => q.eq("lifeGroupId", g._id))
        .collect();
      for (const m of members) {
        if (m.kind === "partner") partnerMembers++;
        else externalMembers++;
      }
    }
    return {
      groupCount: groups.length,
      partnerMembers,
      externalMembers,
      totalMembers: partnerMembers + externalMembers,
      avgGroupSize:
        groups.length > 0
          ? Math.round((partnerMembers + externalMembers) / groups.length)
          : 0,
    };
  },
});

// ─── HO-SIDE: dropdown source ───────────────────────────────

/**
 * The HO's partner form calls this to populate its life-group
 * dropdown. Returns the affiliated church's life groups; returns an
 * empty array if the HO is not affiliated.
 */
export const listForMyChurch = query({
  args: { sessionToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const session = await loadSession(ctx, args.sessionToken);
    if (!session) return [];
    const member = await ctx.db
      .query("members")
      .withIndex("by_user", (q) => q.eq("userId", session.userId))
      .first();
    if (!member) return [];
    const org = await ctx.db.get(member.orgId);
    if (!org || !org.churchId) return [];
    const groups = await ctx.db
      .query("lifeGroups")
      .withIndex("by_church", (q) => q.eq("churchId", org.churchId!))
      .collect();
    return groups
      .map((g) => ({
        id: g._id,
        name: g.name,
        leader: g.leader ?? "",
        meetingDay: g.meetingDay ?? "",
        meetingTime: g.meetingTime ?? "",
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});
