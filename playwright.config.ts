import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  workers: 1,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'reports/playwright-html', open: 'never' }],
    ['json', { outputFile: 'reports/playwright-results.json' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command:
      "powershell -NoProfile -Command \"$env:VITE_DATA_MODE='local'; $env:VITE_FORCE_HTTP='1'; $env:VITE_LOCAL_SEED='full'; $env:VITE_LOCAL_PASSWORD='123456'; $env:VITE_LOCAL_MASTER_EMAIL='master.qa@local'; npm.cmd run dev -- --host 127.0.0.1 --port 4173\"",
    url: 'http://127.0.0.1:4173/login',
    timeout: 120_000,
    reuseExistingServer: false,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
