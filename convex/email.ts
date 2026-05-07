/**
 * Email provider — Resend hook (currently stubbed).
 *
 * Design goal: the rest of the codebase only ever calls into this file.
 * Whether the email actually leaves the building is decided here, by
 * presence of `RESEND_API_KEY`:
 *
 *   - missing  → log to Convex console (dev / pre-launch)
 *   - present  → POST to Resend's API (uncomment the block when ready)
 *
 * Adding Resend later is one env var + uncommenting the fetch block.
 */
"use node";

import { internalAction } from "./_generated/server";
import { v } from "convex/values";

interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  from?: string;
  replyTo?: string;
}

async function sendEmail(payload: EmailPayload): Promise<void> {
  const key = process.env.RESEND_API_KEY;

  if (!key) {
    // Dev / pre-launch fallback. The link is still fully functional —
    // just copy it from the Convex logs and paste into a browser.
    console.log(
      "\n────────────── EMAIL (stub — RESEND_API_KEY not set) ──────────────\n" +
        `To:      ${payload.to}\n` +
        `Subject: ${payload.subject}\n` +
        `From:    ${payload.from ?? "noreply@covenant.local"}\n\n` +
        `${payload.html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()}\n` +
        "─────────────────────────────────────────────────────────────────\n",
    );
    return;
  }

  // TODO Phase 1.4 — flip to real Resend send. Shape final, just uncomment.
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
 * Internal action: compose + send the magic-link email.
 * Scheduled by `auth.requestMagicLink`.
 */
export const sendMagicLink = internalAction({
  args: { email: v.string(), token: v.string() },
  handler: async (_ctx, args) => {
    const appUrl = process.env.APP_URL ?? "http://localhost:5173";
    const link = `${appUrl}/auth.html?token=${args.token}`;
    const expiresInMin = 15;

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #1A1410;">
        <h1 style="font-family: Georgia, serif; font-style: italic; font-weight: 500; font-size: 28px; color: #C9A227; margin: 0 0 24px 0;">✝ Covenant</h1>
        <p style="font-size: 16px; line-height: 1.55; margin: 0 0 16px 0;">Click the button below to sign in to your Covenant account.</p>
        <p style="margin: 28px 0;">
          <a href="${link}" style="display: inline-block; padding: 12px 28px; background: #C9A227; color: #fff; text-decoration: none; border-radius: 4px; font-weight: 500; letter-spacing: 0.04em; text-transform: uppercase; font-size: 13px;">Sign in</a>
        </p>
        <p style="font-size: 13px; color: #5C4A2D; line-height: 1.55; margin: 16px 0;">If the button doesn't work, copy and paste this link:<br><span style="color: #1A1410; word-break: break-all;">${link}</span></p>
        <p style="font-size: 12px; color: #8C7853; margin-top: 32px; line-height: 1.5;">This link expires in ${expiresInMin} minutes and can only be used once. If you didn't request this, you can safely ignore this email.</p>
      </div>
    `.trim();

    await sendEmail({
      to: args.email,
      subject: "Your Covenant sign-in link",
      html,
    });
  },
});
