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
    // Church-member rows in this group (the new source of truth for
    // non-partner attendees). Includes birthday so the roster can show
    // it inline.
    const memberRows = await ctx.db
      .query("churchMembers")
      .withIndex("by_lifeGroup", (q) => q.eq("lifeGroupId", args.id))
      .collect();
    const members: Array<{
      memberId: Id<"churchMembers">;
      name: string;
      contact: string;
      birthday: string;
      status: string;
    }> = memberRows
      .filter((m) => m.churchId === church._id)
      .map((m) => ({
        memberId: m._id,
        name: m.name,
        contact: m.contact ?? "",
        birthday: m.birthday ?? "",
        status: m.status,
      }));

    partners.sort((a, b) =>
      a.orgName.localeCompare(b.orgName) || a.name.localeCompare(b.name),
    );
    externals.sort((a, b) => a.name.localeCompare(b.name));
    members.sort((a, b) => a.name.localeCompare(b.name));
    return {
      id: group._id,
      name: group.name,
      leader: group.leader ?? "",
      meetingDay: group.meetingDay ?? "",
      meetingTime: group.meetingTime ?? "",
      description: group.description ?? "",
      partners,
      externals,
      members,
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

// ─── CHURCH: assign a partner directly ──────────────────────

/**
 * Church picks any partner across affiliated HOs and assigns them
 * to a life group. Writes to `partners.lifeGroupId` (source of
 * truth) — the mirror row in lifeGroupMembers is created inline
 * here so the church's roster query updates without waiting for a
 * separate HO sync round-trip.
 *
 * If an external member row with the same name (case-insensitive)
 * exists in that same group, we drop it — the person's been
 * "promoted" from external placeholder to properly-linked partner.
 */
export const assignPartnerToGroup = mutation({
  args: {
    sessionToken: v.string(),
    lifeGroupId: v.id("lifeGroups"),
    orgId: v.id("orgs"),
    partnerLegacyId: v.number(),
  },
  handler: async (ctx, args) => {
    const church = await requireChurch(ctx, args.sessionToken);
    const group = await ctx.db.get(args.lifeGroupId);
    if (!group || group.churchId !== church._id) {
      throw new Error("Life group not found.");
    }
    const org = await ctx.db.get(args.orgId);
    if (!org || org.churchId !== church._id) {
      throw new Error("Home Office not affiliated with your church.");
    }
    const partner = await ctx.db
      .query("partners")
      .withIndex("by_org_legacyId", (q) =>
        q.eq("orgId", args.orgId).eq("legacyId", args.partnerLegacyId),
      )
      .unique();
    if (!partner) throw new Error("Partner not found.");

    // Wipe any existing mirror row(s) for this partner — they might
    // have been in a different life group before.
    const existing = await ctx.db
      .query("lifeGroupMembers")
      .withIndex("by_org_partner", (q) =>
        q.eq("orgId", args.orgId).eq("partnerLegacyId", args.partnerLegacyId),
      )
      .collect();
    for (const m of existing) await ctx.db.delete(m._id);

    // Point the partner at the new group and insert the fresh mirror.
    await ctx.db.patch(partner._id, { lifeGroupId: args.lifeGroupId });
    await ctx.db.insert("lifeGroupMembers", {
      lifeGroupId: args.lifeGroupId,
      kind: "partner",
      orgId: args.orgId,
      partnerLegacyId: args.partnerLegacyId,
      addedAt: Date.now(),
    });

    // Drop any matching external placeholder in this group. Name
    // match is case-insensitive after trimming; we compare against
    // "fn ln" formatted with a single space in between.
    const partnerName = `${partner.fn ?? ""} ${partner.ln ?? ""}`.trim().toLowerCase();
    if (partnerName) {
      const externals = await ctx.db
        .query("lifeGroupMembers")
        .withIndex("by_lifeGroup", (q) => q.eq("lifeGroupId", args.lifeGroupId))
        .collect();
      for (const m of externals) {
        if (m.kind !== "external") continue;
        const extName = (m.externalName ?? "").trim().toLowerCase();
        if (extName && extName === partnerName) {
          await ctx.db.delete(m._id);
        }
      }
    }
    return { ok: true };
  },
});

/**
 * Church unassigns a partner from whatever life group they're in.
 * Doesn't restore the external placeholder — the church can add
 * a fresh external row if that's the intent.
 */
export const unassignPartnerFromGroup = mutation({
  args: {
    sessionToken: v.string(),
    orgId: v.id("orgs"),
    partnerLegacyId: v.number(),
  },
  handler: async (ctx, args) => {
    const church = await requireChurch(ctx, args.sessionToken);
    const org = await ctx.db.get(args.orgId);
    if (!org || org.churchId !== church._id) {
      throw new Error("Home Office not affiliated with your church.");
    }
    const partner = await ctx.db
      .query("partners")
      .withIndex("by_org_legacyId", (q) =>
        q.eq("orgId", args.orgId).eq("legacyId", args.partnerLegacyId),
      )
      .unique();
    if (partner && partner.lifeGroupId) {
      await ctx.db.patch(partner._id, { lifeGroupId: undefined });
    }
    const existing = await ctx.db
      .query("lifeGroupMembers")
      .withIndex("by_org_partner", (q) =>
        q.eq("orgId", args.orgId).eq("partnerLegacyId", args.partnerLegacyId),
      )
      .collect();
    for (const m of existing) await ctx.db.delete(m._id);
    return { ok: true };
  },
});

/**
 * Church-facing picker source: every partner across every affiliated
 * Home Office. Includes each partner's current life group id so the
 * modal can grey out or show "already assigned" state.
 */
export const listAvailablePartners = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const church = await requireChurch(ctx, args.sessionToken);
    const orgs = await ctx.db
      .query("orgs")
      .withIndex("by_church", (q) => q.eq("churchId", church._id))
      .collect();
    const rows: Array<{
      orgId: Id<"orgs">;
      orgName: string;
      partnerLegacyId: number;
      name: string;
      role: string;
      status: string;
      currentLifeGroupId: Id<"lifeGroups"> | null;
      currentLifeGroupName: string | null;
    }> = [];
    // Cache group names so we can label current assignments.
    const groupNameById = new Map<string, string>();
    for (const org of orgs) {
      const partners = await ctx.db
        .query("partners")
        .withIndex("by_org", (q) => q.eq("orgId", org._id))
        .collect();
      for (const p of partners) {
        if (p.legacyId == null) continue;
        let curName: string | null = null;
        if (p.lifeGroupId) {
          const cached = groupNameById.get(String(p.lifeGroupId));
          if (cached) curName = cached;
          else {
            const g = await ctx.db.get(p.lifeGroupId);
            if (g) {
              curName = g.name;
              groupNameById.set(String(p.lifeGroupId), g.name);
            }
          }
        }
        rows.push({
          orgId: org._id,
          orgName: org.name,
          partnerLegacyId: p.legacyId,
          name: `${p.fn ?? ""} ${p.ln ?? ""}`.trim(),
          role: p.ro ?? "",
          status: p.st,
          currentLifeGroupId: p.lifeGroupId ?? null,
          currentLifeGroupName: curName,
        });
      }
    }
    rows.sort((a, b) =>
      a.orgName.localeCompare(b.orgName) || a.name.localeCompare(b.name),
    );
    return rows;
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

/**
 * HO's partner form calls this on open so the dropdown reflects
 * whatever the server currently has — not the possibly-stale
 * lifeGroupId in the client's local S.partners. Closes the race
 * where the church assigns/reassigns while the HO CEO's tab is
 * open but pre-refresh: the fresh value lands in the form, and
 * when the CEO saves an unrelated field, the correct lifeGroupId
 * is what gets synced back.
 *
 * Returns null if the caller has no session, no member row, or
 * the partner isn't in their org.
 */
export const getPartnerLifeGroupId = query({
  args: {
    sessionToken: v.string(),
    partnerLegacyId: v.number(),
  },
  handler: async (ctx, args) => {
    const session = await loadSession(ctx, args.sessionToken);
    if (!session) return null;
    const member = await ctx.db
      .query("members")
      .withIndex("by_user", (q) => q.eq("userId", session.userId))
      .first();
    if (!member) return null;
    const partner = await ctx.db
      .query("partners")
      .withIndex("by_org_legacyId", (q) =>
        q.eq("orgId", member.orgId).eq("legacyId", args.partnerLegacyId),
      )
      .unique();
    if (!partner) return null;
    return partner.lifeGroupId ?? null;
  },
});

/**
 * HO's partner form calls this while the CEO types the name.
 * If the exact name (case-insensitive, trimmed) matches an
 * external member row in any of the affiliated church's life
 * groups, we return the match so the form can auto-select that
 * group. No match → returns null.
 */
export const findMatchingLifeGroup = query({
  args: {
    sessionToken: v.optional(v.string()),
    fullName: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await loadSession(ctx, args.sessionToken);
    if (!session) return null;
    const member = await ctx.db
      .query("members")
      .withIndex("by_user", (q) => q.eq("userId", session.userId))
      .first();
    if (!member) return null;
    const org = await ctx.db.get(member.orgId);
    if (!org || !org.churchId) return null;
    const needle = args.fullName.trim().toLowerCase();
    if (!needle) return null;
    const groups = await ctx.db
      .query("lifeGroups")
      .withIndex("by_church", (q) => q.eq("churchId", org.churchId!))
      .collect();
    for (const g of groups) {
      const members = await ctx.db
        .query("lifeGroupMembers")
        .withIndex("by_lifeGroup", (q) => q.eq("lifeGroupId", g._id))
        .collect();
      for (const m of members) {
        if (m.kind !== "external") continue;
        const ext = (m.externalName ?? "").trim().toLowerCase();
        if (ext && ext === needle) {
          return {
            lifeGroupId: g._id,
            lifeGroupName: g.name,
            externalMemberId: m._id,
          };
        }
      }
    }
    return null;
  },
});
