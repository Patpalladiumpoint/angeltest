// Email delivery for the magic link. This is the ONE piece of the portal
// auth upgrade that genuinely cannot be verified in this environment --
// there is no SMTP/API credential configured here, and none can be
// obtained without a human providing one (section 16: "if this
// environment prevents external auth configuration: implement all
// application code required, add environment placeholders, document
// exact provider/configuration steps, clearly mark the feature
// UNVERIFIED"). Everything upstream of this file (token generation,
// hashing, expiry, single-use enforcement, session creation) IS verified
// against real Postgres -- see src/portal/auth.ts and docs/security.md.
//
// PRODUCTION SETUP (not done here, no credentials available):
//   1. Pick a transactional email provider -- Resend is the most direct
//      fit for a Next.js/Vercel stack (a single fetch call, no SMTP setup).
//      Postmark or SES work equally well if there's an existing account.
//   2. Set RESEND_API_KEY (or equivalent) in the environment.
//   3. Replace ConsoleEmailSender below with a real implementation that
//      POSTs to the provider's API. The EmailSender interface is already
//      the only thing callers depend on, so this is a one-file change.
//   4. Verify a real magic-link email round-trips end to end before
//      calling portal auth production-ready -- it is NOT, until that
//      happens even once against a live provider.
export interface EmailSender {
  sendMagicLink(to: string, linkUrl: string): Promise<void>;
}

// Default and only implementation today. Logs the link server-side
// instead of emailing it -- fine for development, and it's how this
// session verified the token lifecycle without a real provider, but it
// means anyone with server log access could sign in as any client
// contact. This must be replaced before a real client ever sees a
// /portal URL. src/app/portal/sign-in/actions.ts also surfaces the link
// directly in the UI response outside production, for the same reason
// and with the same caveat -- see that file's comment.
export class ConsoleEmailSender implements EmailSender {
  async sendMagicLink(to: string, linkUrl: string): Promise<void> {
    console.log(`[portal magic link -- NOT sent by email, no provider configured] ${to}: ${linkUrl}`);
  }
}

export const emailSender: EmailSender = new ConsoleEmailSender();
