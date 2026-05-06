/**
 * Org / member queries + utilities.
 *
 * Phase 1.1: skeleton. Phase 1.2 fills in `getMyOrg`, `createOrgFromLicense`,
 * `requireOrgMember`, and the role-gating helpers.
 */
import { query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Returns the org the current authenticated user belongs to, or null.
 * Used by the app shell on first load to decide between the welcome /
 * import wizard and the main dashboard.
 */
export const getMyOrg = query({
  args: {},
  handler: async (_ctx) => {
    // TODO Phase 1.2:
    //   const userId = await getAuthUserId(ctx);
    //   if (!userId) return null;
    //   const member = await ctx.db
    //     .query("members")
    //     .withIndex("by_user", q => q.eq("userId", userId))
    //     .first();
    //   if (!member) return null;
    //   const org = await ctx.db.get(member.orgId);
    //   return { org, member };
    return null;
  },
});

/**
 * Light-weight check used by mutations: confirms the caller is a member
 * of the given org and returns their role. Throws otherwise.
 */
export async function requireOrgMember(
  _ctx: unknown,
  _orgId: unknown,
): Promise<{ role: "ceo" | "admin" | "accountant" }> {
  // TODO Phase 1.2: real implementation against ctx.auth + members table.
  throw new Error("requireOrgMember: not implemented yet (Phase 1.2)");
}

/**
 * Public placeholder — let the frontend display config (logo, name)
 * even before the user is signed in (e.g., on the landing page footer).
 * Future revision may scope to a specific org by domain.
 */
export const getPublicConfig = query({
  args: { orgId: v.optional(v.id("orgs")) },
  handler: async (ctx, args) => {
    if (!args.orgId) return null;
    const org = await ctx.db.get(args.orgId);
    if (!org) return null;
    return {
      name: org.name,
      logo: org.logo ?? null,
    };
  },
});
