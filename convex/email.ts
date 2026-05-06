/**
 * Email provider — Resend hook (currently stubbed).
 *
 * Design goal: the rest of the codebase only ever calls `sendEmail()`.
 * Whether the email actually leaves the building is decided here, by
 * presence of `RESEND_API_KEY`:
 *
 *   - missing  → log to Convex console (dev / pre-launch testing)
 *   - present  → POST to Resend's API
 *
 * Adding Resend later is one env var + dropping `// TODO` block below.
 *
 * Use:
 *   import { sendEmail } from "./email";
 *   await sendEmail(ctx, {
 *     to: "buyer@example.com",
 *     subject: "Your Covenant access",
 *     html: "<p>Click <a href='...'>here</a> to sign in.</p>",
 *   });
 */
"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";

interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  from?: string;          // defaults to noreply@<APP_URL host>
  replyTo?: string;
}

export async function sendEmail(payload: EmailPayload): Promise<void> {
  const key = process.env.RESEND_API_KEY;

  if (!key) {
    // Pre-launch / dev fallback. The magic link is fully functional in
    // dev mode — you copy it from the Convex logs and paste it into a
    // browser. For the first batch of paying customers you can also
    // hand-deliver via Messenger/SMS.
    console.log(
      "\n────────────── EMAIL (stub — RESEND_API_KEY not set) ──────────────\n" +
      `To:      ${payload.to}\n` +
      `Subject: ${payload.subject}\n` +
      `From:    ${payload.from ?? "noreply@covenant.local"}\n\n` +
      `${payload.html.replace(/<[^>]+>/g, "").trim()}\n` +
      "─────────────────────────────────────────────────────────────────\n",
    );
    return;
  }

  // TODO Phase 1.2 — actual Resend POST. Shape is final; just uncomment
  // when RESEND_API_KEY lands and the from-domain DNS (SPF/DKIM) is set.
  //
  // const res = await fetch("https://api.resend.com/emails", {
  //   method: "POST",
  //   headers: {
  //     "Content-Type": "application/json",
  //     Authorization: `Bearer ${key}`,
  //   },
  //   body: JSON.stringify({
  //     from: payload.from ?? "Covenant <noreply@covenant.app>",
  //     to: [payload.to],
  //     subject: payload.subject,
  //     html: payload.html,
  //     reply_to: payload.replyTo,
  //   }),
  // });
  // if (!res.ok) {
  //   const body = await res.text();
  //   throw new Error(`Resend send failed: ${res.status} ${body}`);
  // }
}

/**
 * Convex action wrapper — callable from mutations / scheduled jobs that
 * need to fire an email side-effect. Mutations themselves can't call
 * `fetch`, so we hop through this action.
 */
export const send = action({
  args: {
    to: v.string(),
    subject: v.string(),
    html: v.string(),
    from: v.optional(v.string()),
    replyTo: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    await sendEmail(args);
  },
});
