/**
 * Email — Resend integration.
 *
 * Behaviour gated on `RESEND_API_KEY`:
 *   - missing → log the message to the Convex console (dev mode)
 *   - present → POST to https://api.resend.com/emails
 *
 * Optional env vars:
 *   - RESEND_FROM = "Covenant <noreply@yourdomain.com>"
 *     Defaults to "Covenant <onboarding@resend.dev>", which is
 *     Resend's sandbox sender — works without DNS setup, deliverability
 *     is OK for transactional but customers will see resend.dev. Switch
 *     to a verified custom domain when you own one.
 *   - RESEND_REPLY_TO  (optional)
 *     The address customers reach if they hit "Reply" — typically your
 *     real support inbox (e.g. asignacionalp@gmail.com).
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
  const defaultFrom =
    process.env.RESEND_FROM ?? "Covenant <onboarding@resend.dev>";
  const defaultReplyTo = process.env.RESEND_REPLY_TO;

  const from = payload.from ?? defaultFrom;
  const replyTo = payload.replyTo ?? defaultReplyTo;

  if (!key) {
    // Pre-launch fallback. Magic link still works — copy it from the
    // log and hand-deliver via Messenger/SMS to early customers.
    console.log(
      "\n────────────── EMAIL (stub — RESEND_API_KEY not set) ──────────────\n" +
        `To:      ${payload.to}\n` +
        `From:    ${from}\n` +
        `Subject: ${payload.subject}\n\n` +
        `${payload.html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()}\n` +
        "─────────────────────────────────────────────────────────────────\n",
    );
    return;
  }

  let res: Response;
  try {
    res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        from,
        to: [payload.to],
        subject: payload.subject,
        html: payload.html,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });
  } catch (err) {
    console.error("[email] network error reaching Resend:", err);
    throw new Error("Could not reach Resend.");
  }

  if (!res.ok) {
    const body = await res.text();
    console.error(`[email] Resend ${res.status}:`, body);
    // Try to extract the human-readable reason so the Convex error
    // surface is actually useful when this fails in production.
    let reason = `${res.status}`;
    try {
      const parsed = JSON.parse(body);
      if (parsed?.message) reason = `${res.status} — ${parsed.message}`;
      else if (parsed?.error) reason = `${res.status} — ${parsed.error}`;
    } catch {
      // Body wasn't JSON; leave reason as the status code.
    }
    throw new Error(`Resend rejected the message: ${reason}`);
  }

  const json = (await res.json().catch(() => null)) as
    | { id?: string }
    | null;
  console.log(
    `[email] sent to ${payload.to} via Resend${
      json?.id ? ` (id ${json.id})` : ""
    }`,
  );
}

/**
 * Internal action: compose + send the magic-link email.
 * Scheduled by `auth.requestMagicLink` (which is called either when
 * a returning user signs in via /signin.html, or automatically by
 * the PayMongo webhook after a successful checkout).
 */
export const sendMagicLink = internalAction({
  args: { email: v.string(), token: v.string() },
  handler: async (_ctx, args) => {
    const appUrl = process.env.APP_URL ?? "http://localhost:5173";
    const link = `${appUrl}/auth.html?token=${args.token}`;
    const expiresInMin = 15;

    const html = `
      <!doctype html>
      <html>
      <body style="margin:0;padding:0;background:#F4EDD9;font-family:Cardo,Georgia,serif;">
        <div style="max-width:520px;margin:0 auto;padding:36px 24px;color:#1A1410;">
          <div style="text-align:center;margin-bottom:32px;">
            <span style="font-size:32px;color:#C9A227;">✝</span>
            <h1 style="font-family:Georgia,serif;font-style:italic;font-weight:500;font-size:30px;color:#1A1410;margin:8px 0 0;letter-spacing:-0.01em;">Covenant</h1>
            <p style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#8C7853;margin-top:6px;">Ministry Accounting &amp; HRIS</p>
          </div>

          <p style="font-size:16px;line-height:1.6;margin:0 0 22px;">Click the button below to sign in to your Covenant workspace.</p>

          <p style="text-align:center;margin:30px 0;">
            <a href="${link}" style="display:inline-block;padding:14px 36px;background:#C9A227;color:#0E1830;text-decoration:none;border-radius:5px;font-family:'DM Sans',Helvetica,Arial,sans-serif;font-weight:500;letter-spacing:.06em;text-transform:uppercase;font-size:13px;">Sign in</a>
          </p>

          <p style="font-size:12px;color:#5C4A2D;line-height:1.6;margin:18px 0;">If the button doesn't work, copy and paste this link:<br><span style="color:#1A1410;word-break:break-all;">${link}</span></p>

          <hr style="border:none;border-top:1px solid #D4C690;margin:32px 0;"/>

          <p style="font-size:11px;color:#8C7853;line-height:1.6;margin:0;">This link expires in ${expiresInMin} minutes and can only be used once. If you didn't request this, you can safely ignore this email — no action required.</p>

          <p style="font-family:Georgia,serif;font-style:italic;color:#8C7853;font-size:12px;text-align:center;margin-top:24px;">"Bring the whole tithe into the storehouse." — Malachi 3:10</p>
        </div>
      </body>
      </html>
    `.trim();

    await sendEmail({
      to: args.email,
      subject: "Your Covenant sign-in link",
      html,
    });
  },
});
