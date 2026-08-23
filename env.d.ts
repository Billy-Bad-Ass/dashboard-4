/// <reference types="@cloudflare/workers-types" />

declare global {
  interface CloudflareEnv {
    DB: D1Database;
    CACHE: KVNamespace;
    ARCHIVE: R2Bucket;

    /** Public vars, set in wrangler.jsonc. */
    NEXT_PUBLIC_SITE_URL?: string;
    GITHUB_OWNER?: string;
    CALENDAR_ACCOUNT?: string;

    /** Secrets, set with `wrangler secret put`. All optional: every connector
     *  degrades to a clearly-labelled "not connected" state without them. */
    STRIPE_SECRET_KEY?: string;
    GITHUB_TOKEN?: string;
    CLOUDFLARE_API_TOKEN?: string;
    CLOUDFLARE_ACCOUNT_ID?: string;
    /** Secret address of the Google Calendar private ICS feed. */
    CALENDAR_ICS_URL?: string;
    /** Shared secret for the write API and the cron-triggered agent dispatch. */
    DASHBOARD_TOKEN?: string;
  }
}

export {};
