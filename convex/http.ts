/**
 * HTTP routes — public endpoints exposed by Convex.
 *
 * Phase 1.1: skeleton with a single PayMongo webhook handler stub.
 *
 * The PayMongo webhook receives a notification when a checkout session
 * succeeds. We:
 *   1. Verify the signature using PAYMONGO_WEBHOOK_SECRET
 *   2. Idempotently create a `licenses` row
 *   3. Generate a one-time `signupToken`
 *   4. Email the buyer a magic link to /signup?token=<token>
 *
 * Phase 1.3 implements the body of these handlers.
 */
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";

const http = httpRouter();

http.route({
  path: "/paymongo/webhook",
  method: "POST",
  handler: httpAction(async (_ctx, request) => {
    // TODO Phase 1.3:
    //   - Read raw body (request.text())
    //   - Verify HMAC signature header against PAYMONGO_WEBHOOK_SECRET
    //   - Parse event; only handle `checkout_session.payment.paid`
    //   - Insert a `licenses` row (upsert by paymongoPaymentId)
    //   - Generate signupToken (24-char random)
    //   - Schedule email.sendEmail with magic link
    //   - Return 200 quickly so PayMongo doesn't retry
    void request;
    return new Response(
      JSON.stringify({ received: true, todo: "phase-1.3" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }),
});

http.route({
  path: "/health",
  method: "GET",
  handler: httpAction(async () => {
    return new Response(
      JSON.stringify({ status: "ok", phase: "1.1" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }),
});

export default http;
