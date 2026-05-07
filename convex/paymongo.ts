/**
 * PayMongo integration — checkout session creation.
 *
 * Flow:
 *   1. Frontend (landing page) calls `paymongo:createCheckoutSession`
 *      with the buyer's email.
 *   2. This action POSTs to PayMongo's `/v1/checkout_sessions` API,
 *      configuring a ₱1,000 single line-item with all payment methods
 *      enabled (cards, GCash, Maya, GrabPay, online banking, billease).
 *   3. PayMongo returns a `checkout_url` — the action returns it.
 *   4. Frontend redirects the browser to that URL.
 *   5. Buyer completes payment on PayMongo's hosted page.
 *   6. PayMongo POSTs to our webhook (`/paymongo/webhook`) — handled
 *      in `http.ts`.
 *   7. PayMongo also redirects the buyer back to `success_url` after
 *      payment, which lands them on `/buy-success.html`.
 *
 * Required env vars (set via Convex dashboard → Settings → Env Vars):
 *   - PAYMONGO_SECRET_KEY      = `sk_test_...` or `sk_live_...`
 *   - APP_URL                  = `https://covenant.<acct>.workers.dev`
 *
 * Test card numbers (works in test mode):
 *   - 4343 4343 4343 4345  (Visa, succeeds)
 *   - 5577 0000 5577 0004  (Mastercard, succeeds)
 *   - any future expiry, any 3-digit CVC
 */
"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";

const PAYMONGO_API = "https://api.paymongo.com/v1";

// Amounts in centavos. ₱1,000 = 100000.
const PRICE_CENTAVOS = 100000;

interface PayMongoCheckoutResponse {
  data?: {
    id: string;
    type: string;
    attributes: {
      checkout_url: string;
      reference_number: string;
      payment_intent: { id: string };
    };
  };
  errors?: Array<{ code: string; detail: string }>;
}

export const createCheckoutSession = action({
  args: {
    email: v.string(),
  },
  handler: async (_ctx, args): Promise<{ url: string; sessionId: string }> => {
    const secretKey = process.env.PAYMONGO_SECRET_KEY;
    if (!secretKey) {
      throw new Error(
        "PayMongo isn't configured yet. Set PAYMONGO_SECRET_KEY in the Convex dashboard.",
      );
    }
    const appUrl = process.env.APP_URL ?? "https://covenant.asignacionalp.workers.dev";

    const email = args.email.trim().toLowerCase();
    if (!email || !email.includes("@") || email.length > 254) {
      throw new Error("Please provide a valid email address.");
    }

    // PayMongo's "Basic" auth uses the secret key as the username, no password.
    const auth =
      "Basic " + Buffer.from(secretKey + ":").toString("base64");

    const body = {
      data: {
        attributes: {
          billing: { email },
          send_email_receipt: true,
          show_description: true,
          show_line_items: true,
          line_items: [
            {
              currency: "PHP",
              amount: PRICE_CENTAVOS,
              name: "Covenant — Ministry Accounting & HRIS",
              description: "Lifetime access for one CEO. One-time payment.",
              quantity: 1,
            },
          ],
          payment_method_types: [
            "card",
            "gcash",
            "paymaya",
            "grab_pay",
            "billease",
            "dob", // online banking (UnionBank/BPI/etc.)
          ],
          description: "Covenant — Ministry Accounting & HRIS access",
          success_url: `${appUrl}/buy-success.html`,
          cancel_url: `${appUrl}/?canceled=1`,
          metadata: {
            buyer_email: email,
            product: "covenant-ceo-license",
          },
        },
      },
    };

    let res: Response;
    try {
      res = await fetch(`${PAYMONGO_API}/checkout_sessions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: auth,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      console.error("[paymongo] network error:", err);
      throw new Error("Could not reach PayMongo. Try again in a minute.");
    }

    const json = (await res.json()) as PayMongoCheckoutResponse;

    if (!res.ok || !json.data) {
      const detail =
        json.errors && json.errors[0] ? json.errors[0].detail : "unknown error";
      console.error("[paymongo] checkout creation failed:", res.status, json);
      throw new Error(`PayMongo refused the checkout: ${detail}`);
    }

    return {
      url: json.data.attributes.checkout_url,
      sessionId: json.data.id,
    };
  },
});
