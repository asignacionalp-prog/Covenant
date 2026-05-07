/**
 * Magic-link auth — custom, lightweight.
 *
 * Flow:
 *   1. requestMagicLink({ email })          ← public mutation
 *      → inserts authToken row, schedules sendMagicLinkEmail action
 *
 *   2. (action) email.sendMagicLinkEmail({ email, token })
 *      → composes the link, calls email.sendEmail()
 *        (logs to console while RESEND_API_KEY isn't set)
 *
 *   3. consumeMagicLink({ token })          ← public mutation
 *      → validates the authToken, finds-or-creates the user,
 *        creates a sessions row, returns sessionToken
 *
 *   4. getCurrentUser({ sessionToken })     ← public query
 *      → returns { userId, email, member? }, or null
 *
 *   5. signOut({ sessionToken })            ← public mutation
 *      → deletes the session
 *
 * Tokens are 24 random hex chars. Sessions are 48 random hex chars.
 * Both use Web Crypto's getRandomValues so are cryptographically
 * unguessable.
 */
import { mutation, query, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import type { QueryCtx, MutationCtx } from "./_generated/server";

const TOKEN_LIFETIME_MS = 15 * 60 * 1000;             // 15 minutes
const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function generateToken(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function normalizeEmail(raw: string): string {
  const e = raw.trim().toLowerCase();
  if (!e || !e.includes("@") || e.length > 254) {
    throw new Error("Please provide a valid email address.");
  }
  return e;
}

// ─────────────────────────────────────────────────────────────
// PUBLIC MUTATIONS / QUERIES
// ─────────────────────────────────────────────────────────────

export const requestMagicLink = mutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const email = normalizeEmail(args.email);
    const token = generateToken(24);
    const now = Date.now();

    await ctx.db.insert("authTokens", {
      email,
      token,
      expiresAt: now + TOKEN_LIFETIME_MS,
      createdAt: now,
    });

    // Hop to a Node action to actually send the mail (or log it).
    await ctx.scheduler.runAfter(0, internal.email.sendMagicLink, {
      email,
      token,
    });

    return { ok: true };
  },
});

export const consumeMagicLink = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const authToken = await ctx.db
      .query("authTokens")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();

    if (!authToken) {
      throw new Error("This link is invalid. Request a new one.");
    }
    if (authToken.consumedAt) {
      throw new Error("This link has already been used. Request a new one.");
    }
    if (authToken.expiresAt < now) {
      throw new Error("This link has expired. Request a new one.");
    }

    // Mark the magic-link token consumed (single-use).
    await ctx.db.patch(authToken._id, { consumedAt: now });

    // Find-or-create the user.
    let user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", authToken.email))
      .unique();

    let userId: Id<"users">;
    if (!user) {
      userId = await ctx.db.insert("users", {
        email: authToken.email,
        createdAt: now,
        lastSignInAt: now,
      });
    } else {
      userId = user._id;
      await ctx.db.patch(userId, { lastSignInAt: now });
    }

    // Mint a session.
    const sessionToken = generateToken(48);
    await ctx.db.insert("sessions", {
      userId,
      sessionToken,
      expiresAt: now + SESSION_LIFETIME_MS,
      createdAt: now,
    });

    return { sessionToken };
  },
});

export const getCurrentUser = query({
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

    let org = null as Doc<"orgs"> | null;
    if (member) org = await ctx.db.get(member.orgId);

    return {
      userId: user._id,
      email: user.email,
      member: member
        ? {
            orgId: member.orgId,
            role: member.role,
            fn: member.fn,
            ln: member.ln,
          }
        : null,
      org: org
        ? { id: org._id, name: org.name, titheRate: org.titheRate, cpRate: org.cpRate }
        : null,
    };
  },
});

export const signOut = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("sessionToken", args.sessionToken))
      .unique();
    if (session) await ctx.db.delete(session._id);
    return { ok: true };
  },
});

// ─────────────────────────────────────────────────────────────
// INTERNAL HELPERS — used by other Convex modules to gate access.
// ─────────────────────────────────────────────────────────────

/**
 * Load + validate session in a query/mutation. Returns the session
 * doc or null. Mutations that require auth should call
 * `requireSession()` instead.
 */
export async function loadSession(
  ctx: QueryCtx | MutationCtx,
  sessionToken: string | undefined,
): Promise<Doc<"sessions"> | null> {
  if (!sessionToken) return null;
  const session = await ctx.db
    .query("sessions")
    .withIndex("by_token", (q) => q.eq("sessionToken", sessionToken))
    .unique();
  if (!session) return null;
  if (session.expiresAt < Date.now()) return null;
  return session;
}

/**
 * Throws if the session is missing or invalid. Returns the user doc
 * for convenience.
 */
export async function requireSession(
  ctx: QueryCtx | MutationCtx,
  sessionToken: string | undefined,
): Promise<{ session: Doc<"sessions">; user: Doc<"users"> }> {
  const session = await loadSession(ctx, sessionToken);
  if (!session) throw new Error("Not signed in.");
  const user = await ctx.db.get(session.userId);
  if (!user) throw new Error("User not found.");
  return { session, user };
}
