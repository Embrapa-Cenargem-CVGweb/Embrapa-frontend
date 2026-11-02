import { test, expect, type Page } from '@playwright/test';

/**
 * Administração do CVGWeb em modo demonstração.
 *
 * O foco é o que a tela promete ao administrador: as cinco situações
 * graváveis, o formulário que ALTERA uma das 50 estufas em vez de cadastrar
 * às cegas, o tipo em texto livre e os limites que o sistema recusa.
 *
 * Regra de ouro destes testes: nenhuma asserção olha o estado interno do
 * JavaScript — só o que o administrador vê na tela.
 */

const ADMIN = { usuario: 'admin', senha: 'admin123' };

async function entrar(page: Page): Promise<void> {
  const erros: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.text().includes('sem handler') || m.text().includes('não encontrado')) {
      erros.push(m.text());
    }
  });
  (page as any)._erros = erros;

  await page.goto('/');
  await page.locator('#entrada-usuario').fill(ADMIN.usuario);
  await page.locator('#entrada-senha').fill(ADMIN.senha);
  await page.locator('#entrada-enviar').click();
  await expect(page.locator('#nav-admin')).toBeVisible();
  await page.locator('#nav-admin').click();
  await expect(page.locator('#view-admin')).toHaveClass(/is-active/);
}

/** Linha da tabela de espaços pelo código do cadastro. */
function linha(page: Page, codigo: string) {
  return page.locator('#tbody-espacos tr', { has: page.locator('.code', { hasText: codigo }) }).first();
}

test('tabela de espaços carrega as 50 estufas', async ({ page }) => {
  await entrar(page);
  await expect(page.locator('#tbody-espacos tr')).toHaveCount(50);
  await expect(page.locator('#conta-espacos')).toHaveText('50');
});

test('seletor de situação oferece os cinco estados', async ({ page }) => {
  await entrar(page);

  const seletor = linha(page, 'CVG01').locator('select.status-select');
  await expect(seletor.locator('option')).toHaveText([
    'Disponível para reserva',
    'Reservada',
    'Ocupada',
    'Em manutenção',
    'Inativa',
  ]);

  const valores = await seletor.locator('option')
    .evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
  expect(valores).toEqual(['ATIVA', 'RESERVADA', 'OCUPADA', 'MANUTENCAO', 'INATIVA']);
});

test('marcar como reservada e como ocupada muda o status mostrado', async ({ page }) => {
  await entrar(page);

  const alvo = linha(page, 'CVG02');
  await alvo.locator('select.status-select').selectOption('RESERVADA');
  await expect(alvo.locator('[data-label="Status"]')).toContainText('Reservada');

  await alvo.locator('select.status-select').selectOption('OCUPADA');
  await expect(alvo.locator('[data-label="Status"]')).toContainText('Ocupada');

  await alvo.locator('select.status-select').selectOption('ATIVA');
  await expect(alvo.locator('[data-label="Status"]')).toContainText('Livre');
});

test('a borda do seletor acompanha a situação (data-status em minúscula)', async ({ page }) => {
  await entrar(page);

  const seletor = linha(page, 'CVG03').locator('select.status-select');
  await seletor.selectOption('MANUTENCAO');
  await expect(linha(page, 'CVG03').locator('select.status-select'))
    .toHaveAttribute('data-status', 'manutencao');

  const cor = await linha(page, 'CVG03').locator('select.status-select')
    .evaluate((n) => getComputedStyle(n).borderLeftColor);
  expect(cor).not.toBe('rgba(0, 0, 0, 0)');
});

test('situação sobrevive ao recarregar a página', async ({ page }) => {
  await entrar(page);

  await linha(page, 'CVG04').locator('select.status-select').selectOption('RESERVADA');
  await page.reload();
  await page.locator('#nav-admin').click();

  await expect(linha(page, 'CVG04').locator('select.status-select')).toHaveValue('RESERVADA');
});

test('botão "Alterar estufa" abre o formulário na busca', async ({ page }) => {
  await entrar(page);

  await page.getByRole('button', { name: 'Alterar estufa' }).click();
  await expect(page.locator('#modal-espaco')).toBeVisible();
  await expect(page.locator('#espaco-titulo')).toHaveText('Alterar estufa');
  await expect(page.locator('#espaco-codigo')).toBeFocused();
});

test('digitar CVG0 mostra as sugestões e escolher preenche o formulário', async ({ page }) => {
  await entrar(page);
  await page.getByRole('button', { name: 'Alterar estufa' }).click();

  await page.locator('#espaco-codigo').fill('CVG0');
  const sugestoes = page.locator('#espaco-sugestoes [role="option"]');
  await expect(sugestoes.first()).toBeVisible();
  await expect(sugestoes).toHaveCount(8);
  await expect(sugestoes.first()).toContainText('CVG01');

  // Código completo: carrega sem precisar escolher na lista.
  await page.locator('#espaco-codigo').fill('CVG07');

  await expect(page.locator('#espaco-codigo')).toHaveValue('CVG07');
  await expect(page.locator('#espaco-descricao-campo')).toHaveValue('Estufa 07');
  await expect(page.locator('#espaco-tipo')).toHaveValue('Casa de vegetação');
  await expect(page.locator('#espaco-titulo')).toHaveText('Alterar CVG07');
  await expect(page.locator('#espaco-alvo')).toContainText('CVG07');
});

test('setas e Enter escolhem a estufa pelo teclado', async ({ page }) => {
  await entrar(page);
  await page.getByRole('button', { name: 'Alterar estufa' }).click();

  await page.locator('#espaco-codigo').fill('CVG1');
  await page.locator('#espaco-codigo').press('ArrowDown');
  await page.locator('#espaco-codigo').press('ArrowDown');
  await page.locator('#espaco-codigo').press('Enter');

  await expect(page.locator('#espaco-codigo')).toHaveValue('CVG11');
  await expect(page.locator('#modal-espaco')).toBeVisible();
});

test('código que não existe avisa que vai cadastrar espaço novo', async ({ page }) => {
  await entrar(page);
  await page.getByRole('button', { name: 'Alterar estufa' }).click();

  await page.locator('#espaco-codigo').fill('CVG99');
  await expect(page.locator('#espaco-alvo')).toContainText('cadastrar um espaço novo');
  await expect(page.locator('#espaco-alvo')).toHaveAttribute('data-tom', 'novo');
});

test('o tipo é input de texto livre, não select', async ({ page }) => {
  await entrar(page);
  await page.getByRole('button', { name: 'Alterar estufa' }).click();

  const tipo = page.locator('#espaco-tipo');
  await expect(tipo).toHaveJSProperty('tagName', 'INPUT');
  await expect(tipo).toHaveAttribute('list', 'lista-tipos-espaco');

  await page.locator('#espaco-codigo').fill('CVG05');
  await expect(page.locator('#espaco-titulo')).toHaveText('Alterar CVG05');
  await tipo.fill('Estufa de quarentena');
  await page.locator('#espaco-enviar').click();

  await expect(page.locator('#modal-espaco')).toBeHidden();
  await expect(linha(page, 'CVG05').locator('[data-label="Tipo"]')).toContainText('Estufa de quarentena');
});

test('alterar nome, área, bancadas e situação grava na tabela', async ({ page }) => {
  await entrar(page);
  await page.getByRole('button', { name: 'Alterar estufa' }).click();

  await page.locator('#espaco-codigo').fill('CVG09');
  await expect(page.locator('#espaco-titulo')).toHaveText('Alterar CVG09');

  await page.locator('#espaco-descricao-campo').fill('Estufa 09 — reformada');
  await page.locator('#espaco-localizacao').fill('Setor Oeste');
  await page.locator('#espaco-area').fill('150');
  await page.locator('#espaco-bancadas').fill('7');
  await page.locator('#espaco-capacidade-total').fill('18');
  await page.locator('#espaco-unidade').selectOption('BANCADA');
  await page.locator('#espaco-situacao').selectOption('MANUTENCAO');
  await page.locator('#espaco-obs').fill('Trocando o policarbonato');
  await page.locator('#espaco-enviar').click();

  await expect(page.locator('#modal-espaco')).toBeHidden();

  const alvo = linha(page, 'CVG09');
  await expect(alvo.locator('[data-label="Nome"]')).toContainText('reformada');
  await expect(alvo.locator('[data-label="Área"]')).toHaveText('150 m²');
  await expect(alvo.locator('[data-label="Capacidade"]')).toContainText('18 bancadas');
  await expect(alvo.locator('[data-label="Status"]')).toContainText('Manutenção');
  await expect(alvo.locator('select.status-select')).toHaveValue('MANUTENCAO');
});

test('digitar o código e salvar altera a estufa, não tenta criar outra', async ({ page }) => {
  await entrar(page);
  await page.getByRole('button', { name: 'Alterar estufa' }).click();

  // Sem clicar na sugestão: digita o código, preenche e salva. Já quebrou aqui
  // — o formulário recarregava os campos e apagava o que a pessoa escreveu.
  await page.locator('#espaco-codigo').fill('CVG12');
  await page.locator('#espaco-descricao-campo').fill('Estufa 12 renomeada');
  await page.locator('#espaco-capacidade-total').fill('13');
  await page.locator('#espaco-enviar').click();

  await expect(page.locator('#modal-espaco')).toBeHidden();
  await expect(page.locator('#tbody-espacos tr')).toHaveCount(50);
  await expect(linha(page, 'CVG12').locator('[data-label="Nome"]')).toContainText('renomeada');
});

test('o parque é fechado: a estufa 51 é recusada com explicação', async ({ page }) => {
  await entrar(page);
  await page.getByRole('button', { name: 'Alterar estufa' }).click();

  await page.locator('#espaco-codigo').fill('CVG51');
  await page.locator('#espaco-descricao-campo').fill('Estufa 51');
  await page.locator('#espaco-capacidade-total').fill('10');
  await page.locator('#espaco-enviar').click();

  await expect(page.locator('#espaco-erro')).toBeVisible();
  await expect(page.locator('#espaco-erro-texto')).toContainText('50 espaços');
  await expect(page.locator('#modal-espaco')).toBeVisible();
});

test('reduzir a capacidade abaixo do reservado é recusado', async ({ page }) => {
  await entrar(page);

  // Reserva pelo mapa para ocupar capacidade.
  await page.locator('#nav-mapa').click();
  await page.locator('[data-action="abrir-espaco"][data-id="E20"]').first().click();
  await page.locator('[data-action="abrir-reservar"]').first().click();
  await expect(page.locator('#modal-reservar')).toBeVisible();

  const hoje = new Date().toISOString().slice(0, 10);
  await page.locator('#reservar-data-inicio').fill(hoje);
  await page.locator('#reservar-data-fim').fill(hoje);
  await page.locator('#reservar-quantidade').fill('10');
  await page.locator('#reservar-finalidade').fill('Ensaio de teste');
  await page.locator('#reservar-enviar').click();
  await expect(page.locator('#modal-reservar')).toBeHidden();

  await page.locator('#nav-admin').click();
  await page.getByRole('button', { name: 'Alterar estufa' }).click();
  await page.locator('#espaco-codigo').fill('CVG20');
  await expect(page.locator('#espaco-titulo')).toHaveText('Alterar CVG20');
  await page.locator('#espaco-capacidade-total').fill('2');
  await page.locator('#espaco-enviar').click();

  await expect(page.locator('#espaco-erro')).toBeVisible();
  await expect(page.locator('#espaco-erro-texto')).toContainText('capacidade');
});

/* ---------------------------------------------------------------------------
   Rascunho da reserva
   --------------------------------------------------------------------------- */

/** Abre o modal de reserva de um espaço pelo mapa. */
async function abrirReserva(page: Page, chave: string): Promise<void> {
  await page.locator('#nav-mapa').click();
  await page.locator(`[data-action="abrir-espaco"][data-id="${chave}"]`).first().click();
  await page.locator('[data-action="abrir-reservar"]').first().click();
  await expect(page.locator('#modal-reservar')).toBeVisible();
}

test('clicar fora não apaga a reserva que estava sendo preenchida', async ({ page }) => {
  await entrar(page);
  await abrirReserva(page, 'E25');

  const hoje = new Date().toISOString().slice(0, 10);
  await page.locator('#reservar-data-inicio').fill(hoje);
  await page.locator('#reservar-data-fim').fill(hoje);
  await page.locator('#reservar-quantidade').fill('4');
  await page.locator('#reservar-finalidade').fill('Ensaio de germinação');
  await page.waitForTimeout(400);

  // Clique fora do diálogo, no scrim: foi o acidente que apagava tudo.
  await page.locator('#modal-reservar').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('#modal-reservar')).toBeHidden();

  await abrirReserva(page, 'E25');
  await expect(page.locator('#reservar-data-inicio')).toHaveValue(hoje);
  await expect(page.locator('#reservar-quantidade')).toHaveValue('4');
  await expect(page.locator('#reservar-finalidade')).toHaveValue('Ensaio de germinação');
});

test('o rascunho sobrevive até a recarga da página', async ({ page }) => {
  await entrar(page);
  await abrirReserva(page, 'E26');

  await page.locator('#reservar-quantidade').fill('3');
  await page.locator('#reservar-finalidade').fill('Aclimatação de mudas');
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');

  await page.reload();
  await abrirReserva(page, 'E26');
  await expect(page.locator('#reservar-finalidade')).toHaveValue('Aclimatação de mudas');
  await expect(page.locator('#reservar-quantidade')).toHaveValue('3');
});

test('"Cancelar" descarta o rascunho de propósito', async ({ page }) => {
  await entrar(page);
  await abrirReserva(page, 'E27');

  await page.locator('#reservar-finalidade').fill('Vou desistir desta');
  await page.waitForTimeout(400);
  await page.locator('[data-action="descartar-reserva"]').click();
  await expect(page.locator('#modal-reservar')).toBeHidden();

  await abrirReserva(page, 'E27');
  await expect(page.locator('#reservar-finalidade')).toHaveValue('');
});

test('reservar limpa o rascunho daquele espaço', async ({ page }) => {
  await entrar(page);
  await abrirReserva(page, 'E28');

  const hoje = new Date().toISOString().slice(0, 10);
  await page.locator('#reservar-data-inicio').fill(hoje);
  await page.locator('#reservar-data-fim').fill(hoje);
  await page.locator('#reservar-quantidade').fill('2');
  await page.locator('#reservar-finalidade').fill('Ensaio concluído');
  await page.locator('#reservar-enviar').click();
  await expect(page.locator('#modal-reservar')).toBeHidden();

  await abrirReserva(page, 'E28');
  await expect(page.locator('#reservar-finalidade')).toHaveValue('');
});

test('o assistente não fica atrás da ficha do espaço', async ({ page }) => {
  await entrar(page);
  await page.locator('#nav-mapa').click();

  await page.locator('[data-action="abrir-espaco"][data-id="E05"]').first().click();
  await expect(page.locator('.panel')).toHaveClass(/is-open/);
  await page.waitForTimeout(600);

  const zChat = await page.locator('.chat').evaluate((n) => Number(getComputedStyle(n).zIndex));
  const zPainel = await page.locator('.panel').evaluate((n) => Number(getComputedStyle(n).zIndex));
  expect(zChat).toBeGreaterThan(zPainel);
  await expect(page.locator('.chat')).toBeVisible();

  // Em tela larga ele sai de cima da ficha e fica ao lado dela.
  const chat = await page.locator('.chat').boundingBox();
  const painel = await page.locator('.panel').boundingBox();
  expect(chat!.x + chat!.width).toBeLessThanOrEqual(painel!.x + 1);
});

test('o lápis da linha abre o formulário já naquela estufa', async ({ page }) => {
  await entrar(page);

  await linha(page, 'CVG15').locator('[data-action="editar-espaco"]').click();
  await expect(page.locator('#espaco-titulo')).toHaveText('Alterar CVG15');
  await expect(page.locator('#espaco-codigo')).toHaveValue('CVG15');
});

test('painel de métricas, reservas e usuários abrem', async ({ page }) => {
  await entrar(page);

  await page.locator('[data-action="abrir-painel-metricas"]').first().click();
  await expect(page.locator('#modal-metricas')).toBeVisible();
  await expect(page.locator('#m-total')).toHaveText('50');
  await page.locator('#modal-metricas [data-action="fechar"]').first().click();

  await page.locator('[data-action="abrir-reservas"]').first().click();
  await expect(page.locator('#modal-reservas')).toBeVisible();
  await page.locator('#modal-reservas [data-action="fechar"]').first().click();

  await page.locator('[data-action="abrir-usuarios"]').first().click();
  await expect(page.locator('#modal-usuarios')).toBeVisible();
  await expect(page.locator('#grid-usuarios .user-card')).not.toHaveCount(0);
});

test('nenhum erro de console nem ação sem handler na administração', async ({ page }) => {
  await entrar(page);
  await page.getByRole('button', { name: 'Alterar estufa' }).click();
  await page.locator('#espaco-codigo').fill('CVG0');
  await page.locator('#modal-espaco [data-action="fechar"]').first().click();
  await page.locator('[data-action="abrir-painel-metricas"]').first().click();
  await page.locator('#modal-metricas [data-action="fechar"]').first().click();

  // 404 de imagem não entra: o ambiente de teste pode não trazer a foto aérea.
  const erros = ((page as any)._erros as string[])
    .filter((e) => !e.includes('Failed to load resource'));
  expect(erros, erros.join('\n')).toHaveLength(0);
});

/* ===========================================================================
   Reserva: o que foi preenchido não se perde
   =========================================================================== */

async function abrirReservaDeUmaEstufa(page: Page, id = 'E06'): Promise<void> {
  await page.locator('#nav-mapa').click();
  await page.locator(`[data-action="abrir-espaco"][data-id="${id}"]`).first().click();
  await page.locator('[data-action="abrir-reservar"]').first().click();
  await expect(page.locator('#modal-reservar')).toBeVisible();
}

test('o rascunho é por estufa: um não vaza para o outro', async ({ page }) => {
  await entrar(page);
  await abrirReservaDeUmaEstufa(page, 'E10');
  await page.locator('#reservar-finalidade').fill('Só da estufa 10');
  await page.keyboard.press('Escape');

  await abrirReservaDeUmaEstufa(page, 'E11');
  await expect(page.locator('#reservar-finalidade')).toHaveValue('');
});

test('o assistente fica por cima da ficha do espaço, sem tapar o rodapé', async ({ page }) => {
  await entrar(page);
  await page.locator('#nav-mapa').click();
  await page.locator('[data-action="abrir-espaco"][data-id="E05"]').first().click();
  await expect(page.locator('.panel')).toHaveClass(/is-open/);

  const fab = page.locator('.chat__fab');
  await expect(fab).toBeVisible();

  // Quem está de fato no pixel do botão é o próprio botão, não a ficha.
  const porCima = await fab.evaluate((n) => {
    const r = n.getBoundingClientRect();
    const alvo = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return n.contains(alvo);
  });
  expect(porCima).toBe(true);

  // E o botão "Reservar este espaço" continua clicável.
  await page.locator('[data-action="abrir-reservar"]').first().click();
  await expect(page.locator('#modal-reservar')).toBeVisible();
});

test('código completo carrega o cadastro inteiro, sem zerar nada', async ({ page }) => {
  await entrar(page);

  // Como estava antes: digitar o código apontava para a estufa mas deixava os
  // campos em branco, e salvar gravava capacidade 0 e área vazia por cima.
  const area = await linha(page, 'CVG14').locator('[data-label="Área"]').textContent();

  await page.getByRole('button', { name: 'Alterar estufa' }).click();
  await page.locator('#espaco-codigo').fill('CVG14');

  await expect(page.locator('#espaco-titulo')).toHaveText('Alterar CVG14');
  await expect(page.locator('#espaco-descricao-campo')).toHaveValue('Estufa 14');
  await expect(page.locator('#espaco-capacidade-total')).not.toHaveValue('0');
  await expect(page.locator('#espaco-tipo')).not.toHaveValue('');
  await expect(page.locator('#espaco-area')).toHaveValue((area ?? '').replace(/\D/g, ''));

  // Salvar sem mexer em nada não pode estragar o cadastro.
  await page.locator('#espaco-enviar').click();
  await expect(page.locator('#modal-espaco')).toBeHidden();
  await expect(linha(page, 'CVG14').locator('[data-label="Área"]')).toHaveText(area ?? '');
});
