/**
 * HTTP routes — public endpoints exposed by Convex.
 *
 *   GET  /health             health probe
 *   POST /paymongo/webhook   PayMongo posts payment events here
 *
 * The webhook does three things:
 *   1. Verifies the HMAC-SHA256 signature against PAYMONGO_WEBHOOK_SECRET
 *      using a constant-time comparison
 *   2. On `checkout_session.payment.paid`, idempotently creates a
 *      `licenses` row for the buyer
 *   3. Calls `auth:requestMagicLink` for the buyer's email so a
 *      sign-in email goes out automatically
 *
 * PayMongo signature header format:
 *   Paymongo-Signature: t=<timestamp>,te=<test_sig>,li=<live_sig>
 * Signature payload: `${timestamp}.${rawRequestBody}` (no JSON
 * re-serialization — must use the bytes you received).
 */
import { httpRouter } from "convex/server";
import { httpAction, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { internal, api } from "./_generated/api";

const http = httpRouter();

// ─── HEALTH ──────────────────────────────────────────────────

http.route({
  path: "/health",
  method: "GET",
  handler: httpAction(async () => {
    return new Response(
      JSON.stringify({ status: "ok", phase: "1.3" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }),
});

// ─── PAYMONGO WEBHOOK ────────────────────────────────────────

http.route({
  path: "/paymongo/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const rawBody = await request.text();
    const sigHeader = request.headers.get("paymongo-signature");
    const secret = process.env.PAYMONGO_WEBHOOK_SECRET;

    if (!secret) {
      console.error("[webhook] PAYMONGO_WEBHOOK_SECRET not configured");
      return new Response("misconfigured", { status: 500 });
    }
    if (!sigHeader) {
      return new Response("missing signature", { status: 400 });
    }

    // Parse: t=...,te=...,li=...
    const parts = Object.fromEntries(
      sigHeader.split(",").map((p) => {
        const i = p.indexOf("=");
        return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
      }),
    );
    const ts = parts.t;
    // We accept both test- and live-mode signatures so we don't need
    // separate webhook URLs for dev vs prod. Whichever one matches wins.
    const candidates = [parts.te, parts.li].filter(Boolean) as string[];
    if (!ts || candidates.length === 0) {
      return new Response("malformed signature", { status: 400 });
    }

    // Replay-protection: reject if timestamp is older than 5 minutes.
    const tsMs = Number(ts) * 1000;
    if (!Number.isFinite(tsMs) || Math.abs(Date.now() - tsMs) > 5 * 60 * 1000) {
      return new Response("stale timestamp", { status: 400 });
    }

    // Compute expected signature: HMAC-SHA256(`${ts}.${rawBody}`)
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign(
      "HMAC",
      key,
      enc.encode(`${ts}.${rawBody}`),
    );
    const expected = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const matched = candidates.some((c) => timingSafeEq(c, expected));
    if (!matched) {
      console.warn("[webhook] signature mismatch");
      return new Response("invalid signature", { status: 401 });
    }

    // Parse body. We've verified the bytes; from here on the JSON
    // can be trusted to come from PayMongo.
    let event: any;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return new Response("malformed json", { status: 400 });
    }

    const eventType: string =
      event?.data?.attributes?.type ?? event?.type ?? "";

    // We only care about successful checkouts. Ignore everything else
    // but acknowledge with 200 so PayMongo doesn't retry.
    if (eventType !== "checkout_session.payment.paid") {
      return new Response(
        JSON.stringify({ received: true, ignored: eventType }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    const checkout = event.data.attributes.data;
    const checkoutId: string = checkout?.id ?? "unknown";
    const checkoutAttrs = checkout?.attributes ?? {};
    const amount: number = Number(checkoutAttrs?.line_items?.[0]?.amount ?? 0);
    const currency: string = String(
      checkoutAttrs?.line_items?.[0]?.currency ?? "PHP",
    );
    const email: string = String(
      checkoutAttrs?.billing?.email ??
        checkoutAttrs?.metadata?.buyer_email ??
        "",
    )
      .trim()
      .toLowerCase();

    if (!email) {
      console.error("[webhook] checkout has no email", checkoutId);
      return new Response("no email", { status: 400 });
    }

    // Idempotently create the license + fire the magic link.
    const created = await ctx.runMutation(
      internal.http.recordPaidCheckoutInternal,
      {
        paymongoPaymentId: checkoutId,
        email,
        amount,
        currency,
      },
    );

    if (created.fresh) {
      // Trigger the magic-link send via the existing auth pathway —
      // the webhook is now PayMongo-equivalent of the user clicking
      // "Send magic link" on /signin with their email.
      try {
        await ctx.runMutation(api.auth.requestMagicLink, { email });
      } catch (err) {
        console.error("[webhook] requestMagicLink failed:", err);
      }
    }

    return new Response(
      JSON.stringify({ received: true, fresh: created.fresh }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }),
});

// ─── INTERNAL — license creation (called from the webhook) ──

export const recordPaidCheckoutInternal = internalMutation({
  args: {
    paymongoPaymentId: v.string(),
    email: v.string(),
    amount: v.number(),
    currency: v.string(),
  },
  handler: async (ctx, args) => {
    // Idempotency: if a license already exists for this checkout id,
    // do nothing. PayMongo retries failed webhooks with the same
    // payload — we don't want to mint two licenses per purchase.
    const existing = await ctx.db
      .query("licenses")
      .withIndex("by_paymongo_payment", (q) =>
        q.eq("paymongoPaymentId", args.paymongoPaymentId),
      )
      .first();
    if (existing) return { fresh: false, licenseId: existing._id };

    const now = Date.now();
    const tokenBytes = new Uint8Array(24);
    crypto.getRandomValues(tokenBytes);
    const signupToken = Array.from(tokenBytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const licenseId = await ctx.db.insert("licenses", {
      email: args.email,
      paymongoPaymentId: args.paymongoPaymentId,
      amount: args.amount,
      currency: args.currency,
      signupToken,
      tokenExpiresAt: now + 30 * 24 * 60 * 60 * 1000, // 30 days
      status: "paid",
      createdAt: now,
    });
    return { fresh: true, licenseId };
  },
});

// ─── helpers ──────────────────────────────────────────────────

function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export default http;
