/**
 * Church members — the church's own master roster (separate from HO
 * partners). Active members appear in Direct income name pickers;
 * inactive members are hidden from picklists but remain visible in
 * the Members tab for reactivation or audit.
 *
 * The `listGivers` query is the canonical "who's the giver?" source:
 * unions active partners across every affiliated HO with active
 * church members, so the CEO gets one dropdown regardless of source.
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

// ─── Members CRUD ──────────────────────────────────────────

export const list = query({
  args: {
    sessionToken: v.string(),
    includeInactive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const church = await requireChurch(ctx, args.sessionToken);
    const rows = await ctx.db
      .query("churchMembers")
      .withIndex("by_church", (q) => q.eq("churchId", church._id))
      .collect();
    const filtered = args.includeInactive
      ? rows
      : rows.filter((r) => r.status === "active");
    filtered.sort((a, b) => a.name.localeCompare(b.name));
    return filtered.map((m) => ({
      id: m._id,
      name: m.name,
      contact: m.contact ?? "",
      note: m.note ?? "",
      status: m.status,
      deactivatedAt: m.deactivatedAt ?? "",
      deactivationReason: m.deactivationReason ?? "",
      createdAt: m.createdAt,
    }));
  },
});

export const create = mutation({
  args: {
    sessionToken: v.string(),
    name: v.string(),
    contact: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const church = await requireChurch(ctx, args.sessionToken);
    const name = args.name.trim();
    if (!name) throw new Error("Name is required.");
    const id = await ctx.db.insert("churchMembers", {
      churchId: church._id,
      name,
      contact: args.contact?.trim() || undefined,
      note: args.note?.trim() || undefined,
      status: "active",
      createdAt: Date.now(),
    });
    return { id };
  },
});

export const update = mutation({
  args: {
    sessionToken: v.string(),
    id: v.id("churchMembers"),
    name: v.optional(v.string()),
    contact: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const church = await requireChurch(ctx, args.sessionToken);
    const m = await ctx.db.get(args.id);
    if (!m || m.churchId !== church._id) throw new Error("Member not found.");
    const patch: Partial<Doc<"churchMembers">> = {};
    if (args.name != null) {
      const n = args.name.trim();
      if (!n) throw new Error("Name cannot be blank.");
      patch.name = n;
    }
    if (args.contact != null) patch.contact = args.contact.trim() || undefined;
    if (args.note != null) patch.note = args.note.trim() || undefined;
    await ctx.db.patch(args.id, patch);
    return { ok: true };
  },
});

export const setStatus = mutation({
  args: {
    sessionToken: v.string(),
    id: v.id("churchMembers"),
    status: v.union(v.literal("active"), v.literal("inactive")),
    deactivatedAt: v.optional(v.string()),
    deactivationReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const church = await requireChurch(ctx, args.sessionToken);
    const m = await ctx.db.get(args.id);
    if (!m || m.churchId !== church._id) throw new Error("Member not found.");
    if (args.status === "inactive") {
      await ctx.db.patch(args.id, {
        status: "inactive",
        deactivatedAt: args.deactivatedAt || new Date().toISOString().slice(0, 10),
        deactivationReason: args.deactivationReason?.trim() || undefined,
      });
    } else {
      await ctx.db.patch(args.id, {
        status: "active",
        deactivatedAt: undefined,
        deactivationReason: undefined,
      });
    }
    return { ok: true };
  },
});

export const remove = mutation({
  args: { sessionToken: v.string(), id: v.id("churchMembers") },
  handler: async (ctx, args) => {
    const church = await requireChurch(ctx, args.sessionToken);
    const m = await ctx.db.get(args.id);
    if (!m || m.churchId !== church._id) throw new Error("Member not found.");
    await ctx.db.delete(args.id);
    return { ok: true };
  },
});

// ─── Giver picker (partners + active church members) ───────

/**
 * Combined roster used by the Direct-income "Name" pickers. Returns
 * every ACTIVE partner across every affiliated HO plus every active
 * churchMember. Sorted alphabetically. Includes a `label` field that
 * disambiguates partners with their HO name so a datalist entry like
 * "Maria Cruz (Faith HO)" stays unambiguous when two people share a
 * first name.
 */
export const listGivers = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const church = await requireChurch(ctx, args.sessionToken);
    const orgs = await ctx.db
      .query("orgs")
      .withIndex("by_church", (q) => q.eq("churchId", church._id))
      .collect();
    const rows: Array<{
      key: string;              // stable id for lookup: 'p:<orgId>:<legacyId>' or 'm:<memberId>'
      name: string;
      label: string;            // display: "Name" or "Name (HO Name)"
      source: "partner" | "member";
      orgName: string | null;
      memberId: Id<"churchMembers"> | null;
      contact: string;
    }> = [];
    for (const org of orgs) {
      const partners = await ctx.db
        .query("partners")
        .withIndex("by_org", (q) => q.eq("orgId", org._id))
        .collect();
      for (const p of partners) {
        if (p.st !== "active") continue;
        if (p.legacyId == null) continue;
        const name = `${p.fn ?? ""} ${p.ln ?? ""}`.trim() || "—";
        rows.push({
          key: `p:${org._id}:${p.legacyId}`,
          name,
          label: `${name} (${org.name})`,
          source: "partner",
          orgName: org.name,
          memberId: null,
          contact: p.em ?? p.ct ?? "",
        });
      }
    }
    const members = await ctx.db
      .query("churchMembers")
      .withIndex("by_church_status", (q) =>
        q.eq("churchId", church._id).eq("status", "active"),
      )
      .collect();
    for (const m of members) {
      rows.push({
        key: `m:${m._id}`,
        name: m.name,
        label: m.name,
        source: "member",
        orgName: null,
        memberId: m._id,
        contact: m.contact ?? "",
      });
    }
    rows.sort((a, b) => a.name.localeCompare(b.name));
    return rows;
  },
});
