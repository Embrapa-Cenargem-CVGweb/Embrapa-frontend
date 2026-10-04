/**
 * Em que modo o app está rodando.
 *
 * Sem VITE_API_URL, ou com VITE_USE_MOCK=true, tudo vem dos dados locais de
 * `src/data/mock.ts` e nada é enviado para a rede. Com a API configurada, o
 * login e os dados vêm do back-end Laravel.
 */
export const MODO_DEMO =
  String(import.meta.env.VITE_USE_MOCK) === 'true' || !import.meta.env.VITE_API_URL;
