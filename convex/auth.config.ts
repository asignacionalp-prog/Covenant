/**
 * Convex Auth provider configuration.
 *
 * Phase 1.1: this file declares the magic-link provider but the actual
 * email send is stubbed in `email.ts`. Once a Resend API key is set
 * (RESEND_API_KEY env var), `email.ts` flips from "log to console" to
 * "actually send" with no other code changes required.
 *
 * Phase 1.2 wires this up against `@convex-dev/auth` and exposes the
 * sign-in HTTP routes. For now this is the contract shape we'll implement
 * against.
 */
export default {
  providers: [
    {
      // Convex Auth's email-link (passwordless) provider.
      // The actual Resend integration lives in `email.ts`.
      domain: process.env.APP_URL ?? "http://localhost:5173",
      applicationID: "covenant",
    },
  ],
};
