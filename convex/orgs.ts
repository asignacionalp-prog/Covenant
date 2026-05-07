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
    return { org, member };
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

    // Second call: actually create the org + member, mark the license
    // activated.
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

    return { status: "ready" as const, orgId };
  },
});

// devCreateLicenseForEmail removed in Phase 2b. PayMongo now mints
// licenses via the signed webhook; the dev backdoor is no longer
// needed and would let any signed-in user grant themselves a license
// for any email — a security hole we don't want against a public URL.
// If a developer needs to seed a license for testing, they can insert
// directly through the Convex dashboard.
