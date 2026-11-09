import { defineConfig, devices } from '@playwright/test';

/**
 * Testes de ponta a ponta do CVGWeb.
 *
 * Eles usam o sistema como um usuário usa: entram com nick e senha, cadastram
 * espaço, reservam quantidade, aprovam e recarregam a página para conferir que
 * o que foi feito **sobreviveu** — é assim que se prova que a informação foi
 * para o banco e não para o localStorage.
 *
 * Como rodar contra o seu Docker:
 *
 *   docker compose up -d
 *   cd Embrapa-frontend
 *   npm run dev                     # em outro terminal
 *   npm run test:e2e
 *
 * A API precisa de folga no limite de espaços: a suíte cria estufas
 * descartáveis (prefixo E2E) e o parque de produção é fechado em 50. Rode o
 * back-end de teste com CVG_LIMITE_ESPACOS=60 (ou 0, para não limitar).
 *
 * Variáveis de ambiente:
 *   CVG_URL    endereço do front   (padrão http://localhost:5173)
 *   CVG_API    endereço da API     (padrão http://localhost:8000/api)
 *   CVG_NICK   usuário do teste    (padrão SU)
 *   CVG_SENHA  senha do usuário    (padrão super123)
 */
export default defineConfig({
  testDir: './tests/e2e',
  // O estado do banco é compartilhado: rodar em paralelo faria um teste
  // reservar a capacidade que o outro espera encontrar livre.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: process.env.CVG_URL ?? 'http://localhost:5173',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    // Entra uma vez e guarda a sessão; os testes reaproveitam.
    { name: 'sessão', testMatch: /sessao\.setup\.ts/ },
    {
      name: 'chromium',
      dependencies: ['sessão'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'tests/e2e/.auth/sessao.json',
      },
      testIgnore: /sessao\.setup\.ts/,
    },
  ],
});
