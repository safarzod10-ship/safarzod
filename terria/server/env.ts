export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Public URL of the Mini App (the Worker itself). */
  PUBLIC_URL: string;
  BOT_USERNAME: string;
  /** Bump to re-run the bot setup (webhook, commands, descriptions). */
  BOT_SETUP_VERSION: string;
  /** Secret: the token from @BotFather. Missing in local dev. */
  BOT_TOKEN?: string;
  /** Secret, optional: webhook secret token. Derived from BOT_TOKEN when absent. */
  WEBHOOK_SECRET?: string;
  /** "1" only in local dev: accepts `Authorization: dev <id>` and `X-Dev-Now`. */
  DEV_AUTH?: string;
}
