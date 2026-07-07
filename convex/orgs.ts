/**
 * Org / member queries + bootstrap mutations.
 *
 * Two paths into membership:
 *
 *   1. License-driven (production): a paying CEO buys via PayMongo,
 *      a `licenses` row gets created with their email, they get a
 *      magic link, sign in, then `bootstrapOrgFromLicense` finds
 *      the unconsumed license for their email and creates their org
 *      + member record. Ties the license to the new org.
 *
 *   2. Manual (dev/admin): a license row is created by hand in the
 *      Convex dashboard for the developer's own email — the rest of
 *      the flow is the same.
 *
 * `getMyOrg` reads the org for whoever holds the session token.
 */
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { loadSession, requireSession } from "./auth";

export const getMyOrg = query({
  args: { sessionToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const session = await loadSession(ctx, args.sessionToken);
    if (!session) return null;
    const member = await ctx.db
      .query("members")
      .withIndex("by_user", (q) => q.eq("userId", session.userId))
      .first();
    if (!member) return null;
    const org = await ctx.db.get(member.orgId);
    if (!org) return null;
    // Include the church affiliation status so the Settings card can
    // show "Affiliated with <ChurchName>" without a second round-trip.
    let church = null as null | { name: string; inviteCode: string };
    if (org.churchId) {
      const c = await ctx.db.get(org.churchId);
      if (c) church = { name: c.name, inviteCode: c.inviteCode };
    }
    return { org, member, church };
  },
});

/**
 * CEO-only: paste the church's invite code to affiliate this Home
 * Office with a church. After this, the church's dashboard will show
 * this org and its aggregate/personnel data.
 */
export const affiliateWithChurch = mutation({
  args: { sessionToken: v.string(), inviteCode: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireSession(ctx, args.sessionToken);
    const member = await ctx.db
      .query("members")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();
    if (!member) throw new Error("You don't belong to an organization yet.");
    if (member.role !== "ceo") throw new Error("Only the CEO can affiliate with a church.");
    const code = args.inviteCode.trim().toUpperCase();
    if (!code) throw new Error("Enter the church's invite code.");
    const church = await ctx.db
      .query("churches")
      .withIndex("by_inviteCode", (q) => q.eq("inviteCode", code))
      .unique();
    if (!church) throw new Error("Invite code not recognized. Check with your church for the exact code.");
    await ctx.db.patch(member.orgId, {
      churchId: church._id,
      churchAffiliatedAt: Date.now(),
    });
    return { ok: true, churchName: church.name };
  },
});

/**
 * CEO-only: remove this Home Office's affiliation with a church.
 * The church's dashboard immediately stops seeing this org.
 */
export const unaffiliateFromChurch = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireSession(ctx, args.sessionToken);
    const member = await ctx.db
      .query("members")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();
    if (!member) throw new Error("You don't belong to an organization yet.");
    if (member.role !== "ceo") throw new Error("Only the CEO can remove church affiliation.");
    await ctx.db.patch(member.orgId, {
      churchId: undefined,
      churchAffiliatedAt: undefined,
    });
    return { ok: true };
  },
});

/**
 * Called by the frontend right after a fresh sign-in. If the user
 * already has a member row, returns that org. If not, looks for a
 * paid-but-unactivated license for this user's email and activates
 * it, creating an org + a `ceo` member row.
 *
 * Returns:
 *   { status: "ready", orgId }       — user is in
 *   { status: "no-license" }         — they need to buy access
 *   { status: "needs-info", license } — license found; show org-name form
 */
export const bootstrapOrgFromLicense = mutation({
  args: {
    sessionToken: v.string(),
    orgName: v.optional(v.string()),
    fn: v.optional(v.string()),
    ln: v.optional(v.string()),
    /**
     * Optional — if the bootstrap form collects a password, we hash
     * + store it as part of the same transaction so the user has
     * password sign-in available immediately on next visit.
     */
    password: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireSession(ctx, args.sessionToken);

    // Already a member? Idempotent return.
    const existing = await ctx.db
      .query("members")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();
    if (existing) {
      return { status: "ready" as const, orgId: existing.orgId };
    }

    // Find a paid, unactivated license for this email.
    const license = await ctx.db
      .query("licenses")
      .withIndex("by_email", (q) => q.eq("email", user.email))
      .filter((q) => q.eq(q.field("status"), "paid"))
      .first();

    if (!license) {
      return { status: "no-license" as const };
    }

    // First call: ask the frontend to collect org name + caller's name.
    if (!args.orgName || !args.fn || !args.ln) {
      return {
        status: "needs-info" as const,
        license: {
          id: license._id,
          email: license.email,
          paidAt: license.createdAt,
        },
      };
    }

    // Hash the password BEFORE the transaction's writes so a bad
    // password fails fast without leaving partial state.
    let passwordHash: string | undefined;
    let passwordSetAt: number | undefined;
    if (args.password) {
      passwordHash = await hashPasswordExternal(args.password);
      passwordSetAt = Date.now();
    }

    // Second call: actually create the org + member, mark the license
    // activated, and store the password if provided.
    const now = Date.now();
    const orgId: Id<"orgs"> = await ctx.db.insert("orgs", {
      name: args.orgName,
      titheRate: 10,
      cpRate: 10,
      createdAt: now,
      licenseId: license._id,
    });
    await ctx.db.insert("members", {
      orgId,
      userId: user._id,
      role: "ceo",
      fn: args.fn,
      ln: args.ln,
      em: user.email,
      joinedAt: now,
      status: "active",
    });
    await ctx.db.patch(license._id, {
      status: "activated",
      activatedAt: now,
      activatedOrgId: orgId,
      activatedUserId: user._id,
    });
    if (passwordHash) {
      await ctx.db.patch(user._id, { passwordHash, passwordSetAt });
    }

    return { status: "ready" as const, orgId };
  },
});

// Local copy of the password hasher so this module doesn't have a
// circular import on auth.ts. PBKDF2-SHA256 100K iters, 16-byte salt.
async function hashPasswordExternal(password: string): Promise<string> {
  if (typeof password !== "string" || password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }
  if (password.length > 256) throw new Error("Password is too long.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
    key,
    256,
  );
  const b64 = (b: Uint8Array) => {
    let s = ""; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s);
  };
  return `pbkdf2$100000$${b64(salt)}$${b64(new Uint8Array(bits))}`;
}

// devCreateLicenseForEmail removed in Phase 2b. PayMongo now mints
// licenses via the signed webhook; the dev backdoor is no longer
// needed and would let any signed-in user grant themselves a license
// for any email — a security hole we don't want against a public URL.
// If a developer needs to seed a license for testing, they can insert
// directly through the Convex dashboard.
