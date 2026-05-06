import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:8080',
    viewport: { width: 1280, height: 800 },
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npx serve . -p 8080 --no-clipboard --no-port-switching',
    port: 8080,
    timeout: 10000,
    reuseExistingServer: !process.env.CI,
  },
});
