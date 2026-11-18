import { defineConfig, devices } from '@playwright/test';

const PORT = 18080;
export const ADMIN = 'e2e-admin-token-0123456789abcdef';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${PORT}` },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 720 } } },
    { name: 'phone', use: { ...devices['Pixel 7'] }, testMatch: /panel/ },
  ],
  webServer: {
    command: 'rm -rf tmp/e2e && node --disable-warning=ExperimentalWarning dist/server/server/main.js',
    url: `http://127.0.0.1:${PORT}/healthz`,
    reuseExistingServer: false,
    env: {
      PORT: String(PORT),
      HOST: '127.0.0.1',
      DATA_DIR: 'tmp/e2e',
      ADMIN_TOKEN: ADMIN,
      SECRET_KEY: Buffer.alloc(32, 7).toString('base64'),
      FAST_TIMINGS: '1',
      LOG_LEVEL: 'warn',
      CHROMIUM_PATH: '/nonexistent-chromium',
    },
  },
});
