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
    // Look up life group names in one pass so the client doesn't
    // need a separate query to label the roster.
    const lifeGroupCache = new Map<string, string>();
    const resolved = [];
    for (const m of filtered) {
      let lifeGroupName = "";
      if (m.lifeGroupId) {
        const key = String(m.lifeGroupId);
        if (lifeGroupCache.has(key)) {
          lifeGroupName = lifeGroupCache.get(key)!;
        } else {
          const g = await ctx.db.get(m.lifeGroupId);
          lifeGroupName = g?.name ?? "";
          lifeGroupCache.set(key, lifeGroupName);
        }
      }
      resolved.push({
        id: m._id,
        name: m.name,
        contact: m.contact ?? "",
        note: m.note ?? "",
        status: m.status,
        lifeGroupId: m.lifeGroupId ?? null,
        lifeGroupName,
        birthday: m.birthday ?? "",
        deactivatedAt: m.deactivatedAt ?? "",
        deactivationReason: m.deactivationReason ?? "",
        createdAt: m.createdAt,
      });
    }
    return resolved;
  },
});

async function _assertGroupOwnedByChurch(
  ctx: QueryCtx | MutationCtx,
  churchId: Id<"churches">,
  lifeGroupId: Id<"lifeGroups">,
): Promise<void> {
  const g = await ctx.db.get(lifeGroupId);
  if (!g || g.churchId !== churchId) {
    throw new Error("That life group doesn't belong to your church.");
  }
}

export const create = mutation({
  args: {
    sessionToken: v.string(),
    name: v.string(),
    contact: v.optional(v.string()),
    note: v.optional(v.string()),
    lifeGroupId: v.optional(v.id("lifeGroups")),
    birthday: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const church = await requireChurch(ctx, args.sessionToken);
    const name = args.name.trim();
    if (!name) throw new Error("Name is required.");
    if (args.lifeGroupId) {
      await _assertGroupOwnedByChurch(ctx, church._id, args.lifeGroupId);
    }
    if (args.birthday && !/^\d{4}-\d{2}-\d{2}$/.test(args.birthday)) {
      throw new Error("Birthday must be YYYY-MM-DD.");
    }
    const id = await ctx.db.insert("churchMembers", {
      churchId: church._id,
      name,
      contact: args.contact?.trim() || undefined,
      note: args.note?.trim() || undefined,
      status: "active",
      lifeGroupId: args.lifeGroupId,
      birthday: args.birthday?.trim() || undefined,
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
    lifeGroupId: v.optional(v.union(v.id("lifeGroups"), v.null())),
    birthday: v.optional(v.string()),
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
    if (args.lifeGroupId !== undefined) {
      if (args.lifeGroupId === null) {
        patch.lifeGroupId = undefined;
      } else {
        await _assertGroupOwnedByChurch(ctx, church._id, args.lifeGroupId);
        patch.lifeGroupId = args.lifeGroupId;
      }
    }
    if (args.birthday !== undefined) {
      const b = (args.birthday || "").trim();
      if (b && !/^\d{4}-\d{2}-\d{2}$/.test(b)) {
        throw new Error("Birthday must be YYYY-MM-DD.");
      }
      patch.birthday = b || undefined;
    }
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

/**
 * Bulk insert. Skips blank rows silently and rows whose name already
 * matches an existing member (case-insensitive across active + inactive)
 * so re-uploading a roster with a few new names never dups the old ones.
 * Returns {inserted, skippedDup, errors} so the UI can show a summary.
 */
export const createMany = mutation({
  args: {
    sessionToken: v.string(),
    entries: v.array(v.object({
      name: v.string(),
      contact: v.optional(v.string()),
      note: v.optional(v.string()),
      lifeGroupId: v.optional(v.id("lifeGroups")),
      birthday: v.optional(v.string()),
    })),
  },
  handler: async (ctx, args) => {
    const church = await requireChurch(ctx, args.sessionToken);
    const existing = await ctx.db
      .query("churchMembers")
      .withIndex("by_church", (q) => q.eq("churchId", church._id))
      .collect();
    const existingNames = new Set(
      existing.map((m) => m.name.trim().toLowerCase()),
    );
    const seenThisBatch = new Set<string>();
    // Cache group-ownership checks so a batch of 100 rows in the same
    // group only pays for one .get lookup.
    const groupOk = new Set<string>();
    const now = Date.now();
    let inserted = 0;
    let skippedDup = 0;
    const errors: Array<{ row: number; reason: string }> = [];
    for (let i = 0; i < args.entries.length; i++) {
      const e = args.entries[i];
      const name = (e.name || "").trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (existingNames.has(key) || seenThisBatch.has(key)) {
        skippedDup++;
        continue;
      }
      if (e.birthday && !/^\d{4}-\d{2}-\d{2}$/.test(e.birthday)) {
        errors.push({ row: i + 1, reason: "Birthday must be YYYY-MM-DD" });
        continue;
      }
      if (e.lifeGroupId) {
        const gk = String(e.lifeGroupId);
        if (!groupOk.has(gk)) {
          const g = await ctx.db.get(e.lifeGroupId);
          if (!g || g.churchId !== church._id) {
            errors.push({ row: i + 1, reason: "Life group not in your church" });
            continue;
          }
          groupOk.add(gk);
        }
      }
      await ctx.db.insert("churchMembers", {
        churchId: church._id,
        name,
        contact: e.contact?.trim() || undefined,
        note: e.note?.trim() || undefined,
        status: "active",
        lifeGroupId: e.lifeGroupId,
        birthday: e.birthday?.trim() || undefined,
        createdAt: now,
      });
      seenThisBatch.add(key);
      inserted++;
    }
    return { inserted, skippedDup, errors };
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
