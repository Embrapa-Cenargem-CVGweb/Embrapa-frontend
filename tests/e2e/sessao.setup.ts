import { test as setup } from '@playwright/test';
import { ARQUIVO_SESSAO, CREDENCIAIS, entrar } from './apoio';

/**
 * Entra uma única vez e guarda a sessão para os outros testes.
 *
 * Sem isto, cada teste fazia o próprio login e a suíte estourava o limite de
 * tentativas da rota `/login` ("Too Many Attempts") — o que, além de quebrar os
 * testes, revelou que o limite estava apertado para um laboratório inteiro
 * saindo pelo mesmo IP.
 */
setup('entra e guarda a sessão', async ({ page }) => {
  await page.goto('/');
  await entrar(page);

  // O token fica no localStorage; o storageState leva isso para os demais.
  await page.context().storageState({ path: ARQUIVO_SESSAO });

  console.log(`sessão de ${CREDENCIAIS.email} guardada em ${ARQUIVO_SESSAO}`);
});
