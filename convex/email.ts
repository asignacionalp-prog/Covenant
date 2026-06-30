/**
 * Email — pluggable provider.
 *
 * Pick a path by which env vars are set, in priority order:
 *
 *   1. GMAIL_APP_PASSWORD set      → SMTP via nodemailer (your gmail
 *                                    as the From, ~500/day free,
 *                                    works without a verified domain)
 *   2. RESEND_API_KEY set          → POST to Resend (best when you
 *                                    have a verified domain)
 *   3. neither                     → log to Convex console (dev fallback)
 *
 * Optional env vars:
 *   - GMAIL_USER             — defaults to the email part of GMAIL_FROM
 *                              or "Covenant" + asignacionalp@gmail.com
 *   - GMAIL_FROM             — full From, e.g. `Covenant <you@gmail.com>`
 *   - RESEND_FROM            — full From, e.g. `Covenant <noreply@yourdomain.com>`
 *                              (defaults to "Covenant <onboarding@resend.dev>")
 *   - RESEND_REPLY_TO        — Reply-to address used in Resend mode
 *
 * For Gmail SMTP: you must enable 2-Step Verification on your Google
 * account, then generate an App Password at
 *   https://myaccount.google.com/apppasswords
 * The 16-character app password (no spaces) goes into
 * GMAIL_APP_PASSWORD. Your gmail address goes into GMAIL_USER.
 */
"use node";

import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import nodemailer from "nodemailer";

interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  from?: string;
  replyTo?: string;
}

async function sendViaGmail(payload: EmailPayload): Promise<void> {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD!;
  if (!user) {
    throw new Error(
      "GMAIL_USER not set. Set your gmail address in Convex env vars.",
    );
  }
  const fromDefault = process.env.GMAIL_FROM ?? `Covenant <${user}>`;
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user, pass },
  });
  try {
    const info = await transporter.sendMail({
      from: payload.from ?? fromDefault,
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
      replyTo: payload.replyTo,
    });
    console.log(
      `[email] sent to ${payload.to} via Gmail SMTP (id ${info.messageId})`,
    );
  } catch (err: any) {
    console.error("[email] Gmail SMTP error:", err);
    throw new Error(
      `Gmail SMTP refused the message: ${err?.message || String(err)}`,
    );
  }
}

async function sendViaResend(payload: EmailPayload): Promise<void> {
  const key = process.env.RESEND_API_KEY!;
  const defaultFrom =
    process.env.RESEND_FROM ?? "Covenant <onboarding@resend.dev>";
  const defaultReplyTo = process.env.RESEND_REPLY_TO;

  const from = payload.from ?? defaultFrom;
  const replyTo = payload.replyTo ?? defaultReplyTo;

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
    let reason = `${res.status}`;
    try {
      const parsed = JSON.parse(body);
      if (parsed?.message) reason = `${res.status} — ${parsed.message}`;
      else if (parsed?.error) reason = `${res.status} — ${parsed.error}`;
    } catch {
      /* body wasn't JSON */
    }
    throw new Error(`Resend rejected the message: ${reason}`);
  }

  const json = (await res.json().catch(() => null)) as { id?: string } | null;
  console.log(
    `[email] sent to ${payload.to} via Resend${
      json?.id ? ` (id ${json.id})` : ""
    }`,
  );
}

async function sendEmail(payload: EmailPayload): Promise<void> {
  if (process.env.GMAIL_APP_PASSWORD) {
    return sendViaGmail(payload);
  }
  if (process.env.RESEND_API_KEY) {
    return sendViaResend(payload);
  }
  // Stub fallback — magic link still works, copy from log.
  console.log(
    "\n────────────── EMAIL (stub — no provider configured) ──────────────\n" +
      `To:      ${payload.to}\n` +
      `Subject: ${payload.subject}\n\n` +
      `${payload.html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()}\n` +
      "─────────────────────────────────────────────────────────────────\n",
  );
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

/**
 * Internal action: send an invitation email to a newly-added member.
 * Scheduled by `sync.syncMembers` the first time a member row gets
 * inserted. Uses the same magic-link token mechanism as ordinary
 * sign-in — the recipient clicks, lands on /auth.html?token=..., the
 * existing consumeMagicLink mutation auto-links their userId to the
 * pending member row.
 */
export const sendMemberInvite = internalAction({
  args: {
    email: v.string(),
    token: v.string(),
    inviterName: v.string(),
  },
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

          <p style="font-size:16px;line-height:1.6;margin:0 0 14px;">${escapeHtml(args.inviterName)} has invited you to their Covenant workspace.</p>
          <p style="font-size:15px;line-height:1.6;margin:0 0 22px;color:#5C4A2D;">Click the button below to accept the invitation and finish setting up your account. The link signs you in directly — no password needed for the first visit.</p>

          <p style="text-align:center;margin:30px 0;">
            <a href="${link}" style="display:inline-block;padding:14px 36px;background:#C9A227;color:#0E1830;text-decoration:none;border-radius:5px;font-family:'DM Sans',Helvetica,Arial,sans-serif;font-weight:500;letter-spacing:.06em;text-transform:uppercase;font-size:13px;">Accept invitation</a>
          </p>

          <p style="font-size:12px;color:#5C4A2D;line-height:1.6;margin:18px 0;">If the button doesn't work, copy and paste this link:<br><span style="color:#1A1410;word-break:break-all;">${link}</span></p>

          <hr style="border:none;border-top:1px solid #D4C690;margin:32px 0;"/>

          <p style="font-size:11px;color:#8C7853;line-height:1.6;margin:0;">This invitation link expires in ${expiresInMin} minutes and can only be used once. If a link expires before you use it, just visit the sign-in page, choose "Recently invited?", and enter this email address to get a fresh one.</p>

          <p style="font-family:Georgia,serif;font-style:italic;color:#8C7853;font-size:12px;text-align:center;margin-top:24px;">"Bring the whole tithe into the storehouse." — Malachi 3:10</p>
        </div>
      </body>
      </html>
    `.trim();

    await sendEmail({
      to: args.email,
      subject: `${args.inviterName} invited you to Covenant`,
      html,
    });
  },
});

// Bare-minimum escape so an inviter name with `<` or `&` doesn't
// inject HTML into the email body.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
