import { z } from 'zod';
import { resolve } from 'node:path';

const bool = z
  .string()
  .optional()
  .transform((v) => v === '1' || v === 'true' || v === 'yes');

const Env = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  HOST: z.string().default('0.0.0.0'),
  DATA_DIR: z.string().default('./data'),
  CLIENT_DIR: z.string().default('./dist/client'),
  ADMIN_TOKEN: z.string().min(24, 'ADMIN_TOKEN must be at least 24 characters'),
  SECRET_KEY: z.string().regex(/^[A-Za-z0-9+/=]{43,44}$/, 'SECRET_KEY must be 32 random bytes in base64'),
  PUBLIC_URL: z.string().url().optional(),
  KICK_CHANNEL: z.string().regex(/^[A-Za-z0-9_-]{1,25}$/).default('safarzod'),
  TRUST_PROXY: bool,
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('warn'),
  BROADCAST_PAGE_URL: z.string().url().optional(),
  CHROMIUM_PATH: z.string().default('chromium'),
  FFMPEG_PATH: z.string().default('ffmpeg'),
  XVFB_PATH: z.string().default('Xvfb'),
  PULSEAUDIO_PATH: z.string().default('pulseaudio'),
  DISPLAY_NUM: z.coerce.number().int().min(1).max(999).default(99),
  FAST_TIMINGS: bool,
  KICK_API_BASE: z.string().url().default('https://api.kick.com'),
  KICK_ID_BASE: z.string().url().default('https://id.kick.com'),
});

export type Config = z.infer<typeof Env> & { dbFile: string; backupDir: string; customAudioDir: string };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${msg}`);
  }
  const c = parsed.data;
  const dataDir = resolve(c.DATA_DIR);
  return {
    ...c,
    DATA_DIR: dataDir,
    dbFile: resolve(dataDir, 'heist.sqlite'),
    backupDir: resolve(dataDir, 'backups'),
    customAudioDir: resolve(dataDir, 'custom-audio'),
  };
}
