/**
 * Church calendar events + HO local events.
 *
 * Church-side (church session): full CRUD over its own events plus
 *   `listExpanded` which expands weekly recurrences over a target
 *   month for calendar rendering.
 *
 * HO-side (user session): read-only view of the affiliated church's
 *   events (via `listForMyChurchMonth`) plus local ad-hoc events
 *   the HO owns via `listLocalForMonth` / `createLocalEvent` /
 *   `deleteLocalEvent`.
 */
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { loadSession } from "./auth";

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

// ─── Recurrence expansion ───────────────────────────────────
// Given a church event and a target YYYY-MM month, emit every date
// on which this event is active. Handles one-off and weekly.

function expandEventForMonth(
  event: Doc<"churchEvents">,
  monthKey: string,
): string[] {
  const [y, m] = monthKey.split("-").map(Number);
  if (!y || !m) return [];
  const daysInMonth = new Date(y, m, 0).getDate();
  const monthStart = `${monthKey}-01`;
  const monthEnd = `${monthKey}-${String(daysInMonth).padStart(2, "0")}`;

  if (event.recurring !== "weekly") {
    // One-off — visible only if it lands in this month.
    return event.date >= monthStart && event.date <= monthEnd ? [event.date] : [];
  }

  // Weekly recurrence: same weekday as event.date, from event.date
  // through (recurringUntil ?? forever), clipped to this month.
  const startD = new Date(event.date + "T00:00:00");
  if (isNaN(startD.getTime())) return [];
  const dow = startD.getDay(); // 0..6
  const endLimit = event.recurringUntil || monthEnd;

  const dates: string[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${monthKey}-${String(d).padStart(2, "0")}`;
    if (iso < event.date) continue;      // before the recurrence starts
    if (iso > endLimit) break;           // past the recurrence end
    const jsDate = new Date(iso + "T00:00:00");
    if (jsDate.getDay() !== dow) continue;
    dates.push(iso);
  }
  return dates;
}

// ─── CHURCH: CRUD ───────────────────────────────────────────

export const list = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const church = await requireChurch(ctx, args.sessionToken);
    const events = await ctx.db
      .query("churchEvents")
      .withIndex("by_church", (q) => q.eq("churchId", church._id))
      .collect();
    events.sort((a, b) => a.date.localeCompare(b.date));
    return events.map((e) => ({
      id: e._id,
      date: e.date,
      title: e.title,
      category: e.category,
      recurring: e.recurring ?? null,
      recurringUntil: e.recurringUntil ?? null,
      description: e.description ?? "",
      createdAt: e.createdAt,
    }));
  },
});

/**
 * Church-side calendar view for a specific month. Every event is
 * expanded so a weekly Sunday Service returns one row per Sunday
 * that falls in the month.
 */
export const listExpanded = query({
  args: { sessionToken: v.string(), monthKey: v.string() },
  handler: async (ctx, args) => {
    const church = await requireChurch(ctx, args.sessionToken);
    const events = await ctx.db
      .query("churchEvents")
      .withIndex("by_church", (q) => q.eq("churchId", church._id))
      .collect();
    type Row = {
      id: Id<"churchEvents">;
      date: string;
      title: string;
      category: "sunday" | "activity";
      recurring: "weekly" | null;
    };
    const rows: Row[] = [];
    for (const e of events) {
      for (const d of expandEventForMonth(e, args.monthKey)) {
        rows.push({
          id: e._id,
          date: d,
          title: e.title,
          category: e.category,
          recurring: e.recurring ?? null,
        });
      }
    }
    rows.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
    return rows;
  },
});

export const create = mutation({
  args: {
    sessionToken: v.string(),
    date: v.string(),
    title: v.string(),
    category: v.union(v.literal("sunday"), v.literal("activity")),
    recurring: v.optional(v.union(v.literal("weekly"))),
    recurringUntil: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const church = await requireChurch(ctx, args.sessionToken);
    const title = args.title.trim();
    if (!title) throw new Error("Title is required.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
      throw new Error("Date must be in YYYY-MM-DD format.");
    }
    const id = await ctx.db.insert("churchEvents", {
      churchId: church._id,
      date: args.date,
      title,
      category: args.category,
      recurring: args.recurring,
      recurringUntil:
        args.recurring === "weekly"
          ? args.recurringUntil?.trim() || undefined
          : undefined,
      description: args.description?.trim() || undefined,
      createdAt: Date.now(),
    });
    return { id };
  },
});

export const update = mutation({
  args: {
    sessionToken: v.string(),
    id: v.id("churchEvents"),
    date: v.optional(v.string()),
    title: v.optional(v.string()),
    category: v.optional(v.union(v.literal("sunday"), v.literal("activity"))),
    recurring: v.optional(v.union(v.literal("weekly"), v.null())),
    recurringUntil: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const church = await requireChurch(ctx, args.sessionToken);
    const event = await ctx.db.get(args.id);
    if (!event || event.churchId !== church._id) {
      throw new Error("Event not found.");
    }
    const patch: Partial<Doc<"churchEvents">> = {};
    if (args.date != null) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
        throw new Error("Date must be in YYYY-MM-DD format.");
      }
      patch.date = args.date;
    }
    if (args.title != null) {
      const t = args.title.trim();
      if (!t) throw new Error("Title cannot be blank.");
      patch.title = t;
    }
    if (args.category != null) patch.category = args.category;
    if (args.recurring !== undefined) {
      patch.recurring = args.recurring === null ? undefined : args.recurring;
      // If we're clearing recurrence, also clear the end date so it
      // doesn't linger as dead metadata on a one-off.
      if (args.recurring === null) patch.recurringUntil = undefined;
    }
    if (args.recurringUntil != null) {
      patch.recurringUntil = args.recurringUntil.trim() || undefined;
    }
    if (args.description != null) {
      patch.description = args.description.trim() || undefined;
    }
    await ctx.db.patch(args.id, patch);
    return { ok: true };
  },
});

export const remove = mutation({
  args: { sessionToken: v.string(), id: v.id("churchEvents") },
  handler: async (ctx, args) => {
    const church = await requireChurch(ctx, args.sessionToken);
    const event = await ctx.db.get(args.id);
    if (!event || event.churchId !== church._id) {
      throw new Error("Event not found.");
    }
    await ctx.db.delete(args.id);
    return { ok: true };
  },
});

// ─── HO-SIDE: church events for the affiliated month ────────

export const listForMyChurchMonth = query({
  args: {
    sessionToken: v.optional(v.string()),
    monthKey: v.string(),
  },
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
    const events = await ctx.db
      .query("churchEvents")
      .withIndex("by_church", (q) => q.eq("churchId", org.churchId!))
      .collect();
    type Row = {
      date: string;
      title: string;
      category: "sunday" | "activity";
      source: "church";
    };
    const rows: Row[] = [];
    for (const e of events) {
      for (const d of expandEventForMonth(e, args.monthKey)) {
        rows.push({
          date: d,
          title: e.title,
          category: e.category,
          source: "church",
        });
      }
    }
    return rows;
  },
});

// ─── HO-SIDE: local events ──────────────────────────────────

export const listLocalForMonth = query({
  args: {
    sessionToken: v.optional(v.string()),
    monthKey: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await loadSession(ctx, args.sessionToken);
    if (!session) return [];
    const member = await ctx.db
      .query("members")
      .withIndex("by_user", (q) => q.eq("userId", session.userId))
      .first();
    if (!member) return [];
    const events = await ctx.db
      .query("localEvents")
      .withIndex("by_org", (q) => q.eq("orgId", member.orgId))
      .collect();
    const monthStart = `${args.monthKey}-01`;
    const [y, m] = args.monthKey.split("-").map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const monthEnd = `${args.monthKey}-${String(daysInMonth).padStart(2, "0")}`;
    return events
      .filter((e) => e.date >= monthStart && e.date <= monthEnd)
      .map((e) => ({
        id: e._id,
        date: e.date,
        title: e.title,
        category: e.category,
        source: "local" as const,
        description: e.description ?? "",
      }));
  },
});

export const createLocalEvent = mutation({
  args: {
    sessionToken: v.string(),
    date: v.string(),
    title: v.string(),
    category: v.union(v.literal("sunday"), v.literal("activity")),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const session = await loadSession(ctx, args.sessionToken);
    if (!session) throw new Error("Sign in required.");
    const member = await ctx.db
      .query("members")
      .withIndex("by_user", (q) => q.eq("userId", session.userId))
      .first();
    if (!member) throw new Error("No organization for this account.");
    const title = args.title.trim();
    if (!title) throw new Error("Title is required.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
      throw new Error("Date must be in YYYY-MM-DD format.");
    }
    const id = await ctx.db.insert("localEvents", {
      orgId: member.orgId,
      date: args.date,
      title,
      category: args.category,
      description: args.description?.trim() || undefined,
      createdAt: Date.now(),
    });
    return { id };
  },
});

export const deleteLocalEvent = mutation({
  args: { sessionToken: v.string(), id: v.id("localEvents") },
  handler: async (ctx, args) => {
    const session = await loadSession(ctx, args.sessionToken);
    if (!session) throw new Error("Sign in required.");
    const member = await ctx.db
      .query("members")
      .withIndex("by_user", (q) => q.eq("userId", session.userId))
      .first();
    if (!member) throw new Error("No organization for this account.");
    const event = await ctx.db.get(args.id);
    if (!event || event.orgId !== member.orgId) {
      throw new Error("Local event not found.");
    }
    await ctx.db.delete(args.id);
    return { ok: true };
  },
});
