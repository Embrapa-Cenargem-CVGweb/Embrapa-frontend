import { defineConfig, devices } from '@playwright/test';

/**
 * Testes da administração em MODO DEMONSTRAÇÃO (dados locais, sem API).
 *
 * A suíte de `tests/e2e` prova que o dado foi para o banco e precisa do Docker
 * de pé. Esta aqui prova o comportamento da tela — seletor de situação,
 * formulário de alteração de estufa, sugestões, limite do parque — e sobe
 * sozinha:
 *
 *   npm run test:admin
 *
 * O servidor do Vite é iniciado pelo próprio Playwright, com VITE_USE_MOCK=true.
 */
export default defineConfig({
  testDir: './tests/demo',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: [['list']],
  webServer: {
    command: 'npm run dev -- --port 5174 --host 127.0.0.1',
    url: 'http://127.0.0.1:5174',
    reuseExistingServer: !process.env.CI,
    env: { VITE_USE_MOCK: 'true', VITE_API_URL: '' },
    timeout: 60_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:5174',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    screenshot: 'only-on-failure',
    trace: 'off',
    ...devices['Desktop Chrome'],
  },
});
