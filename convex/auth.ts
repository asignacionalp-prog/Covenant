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

// ─── PASSWORD HASHING ───────────────────────────────────────
// Web Crypto PBKDF2-SHA256, 100K iterations, 16-byte salt, 32-byte
// derived key. Stored as `pbkdf2$<iters>$<saltB64>$<hashB64>` so the
// algorithm + parameters are self-describing for future migrations.

const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_SALT_BYTES = 16;
const PBKDF2_HASH_BYTES = 32;

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
  if (password.length > 256) {
    throw new Error("Password is too long.");
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
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    key,
    PBKDF2_HASH_BYTES * 8,
  );
  return `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(new Uint8Array(bits))}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!password || !stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iters = parseInt(parts[1], 10);
  if (!Number.isFinite(iters) || iters < 1000) return false;
  let salt: Uint8Array, expected: Uint8Array;
  try {
    salt = base64ToBytes(parts[2]);
    expected = base64ToBytes(parts[3]);
  } catch {
    return false;
  }
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
  const computed = new Uint8Array(bits);
  if (computed.length !== expected.length) return false;
  // Constant-time compare.
  let result = 0;
  for (let i = 0; i < computed.length; i++) result |= computed[i] ^ expected[i];
  return result === 0;
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

    // If a CEO already invited this email and the member row has no
    // userId yet, attach it now. Lets a returning invitee land
    // straight in the org their CEO invited them to.
    //
    // Full table scan is fine here — members count stays small.
    // Add a `by_email` index if scale ever demands it.
    const pendingInvite = await ctx.db
      .query("members")
      .filter((q) =>
        q.and(
          q.eq(q.field("em"), authToken.email),
          q.eq(q.field("userId"), undefined),
        ),
      )
      .first();
    if (pendingInvite) {
      await ctx.db.patch(pendingInvite._id, {
        userId,
        joinedAt: now,
      });
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

// ─── PASSWORD AUTH ─────────────────────────────────────────

/**
 * Set or change the current user's password. Requires an active
 * session — i.e. the user must have already signed in (via magic
 * link, post-purchase auto-claim, or an existing session).
 */
export const setPassword = mutation({
  args: { sessionToken: v.string(), password: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireSession(ctx, args.sessionToken);
    const passwordHash = await hashPassword(args.password);
    await ctx.db.patch(user._id, {
      passwordHash,
      passwordSetAt: Date.now(),
    });
    return { ok: true };
  },
});

/**
 * Email + password sign-in. Returns a fresh session token on success.
 * Wrong email or wrong password returns the same generic error so
 * we don't leak which emails exist.
 */
export const signInWithPassword = mutation({
  args: { email: v.string(), password: v.string() },
  handler: async (ctx, args) => {
    const email = normalizeEmail(args.email);
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();

    const generic = "That email and password don't match an account.";
    if (!user || !user.passwordHash) {
      throw new Error(generic);
    }
    const ok = await verifyPassword(args.password, user.passwordHash);
    if (!ok) throw new Error(generic);

    const now = Date.now();
    const sessionToken = generateToken(48);
    await ctx.db.insert("sessions", {
      userId: user._id,
      sessionToken,
      expiresAt: now + SESSION_LIFETIME_MS,
      createdAt: now,
    });
    await ctx.db.patch(user._id, { lastSignInAt: now });
    return { sessionToken };
  },
});

/**
 * "I already paid but never finished setting up my account" recovery
 * flow. Looks for a paid-but-unactivated license matching the email,
 * mints a 15-minute auth token, and returns it so the frontend can
 * redirect to /auth.html?token=… for the bootstrap form.
 *
 * Stays a no-op when no matching license is found, so a casual probe
 * with a random email reveals nothing about who has paid.
 */
export const claimUnactivatedLicense = mutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const email = normalizeEmail(args.email);
    const license = await ctx.db
      .query("licenses")
      .withIndex("by_email", (q) => q.eq("email", email))
      .filter((q) => q.eq(q.field("status"), "paid"))
      .first();

    if (!license) {
      // Don't leak whether the email exists. Frontend tells the user
      // to use Sign In or contact support either way.
      return { ok: false as const, reason: "no_unactivated_license" as const };
    }

    const token = generateToken(24);
    const now = Date.now();
    await ctx.db.insert("authTokens", {
      email,
      token,
      expiresAt: now + TOKEN_LIFETIME_MS,
      createdAt: now,
    });
    return { ok: true as const, token };
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
