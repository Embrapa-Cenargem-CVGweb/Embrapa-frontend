import { expect, test } from '@playwright/test';
import {
  ESTUFA_REAL,
  MARCA,
  RUN,
  abrirEspacoNoMapa,
  abrirSistema,
  apagarEspacoDeTeste,
  apagarFuncionario,
  capacidadeDoEspaco,
  criarFuncionarioSemSenha,
  disponibilidade,
  emDias,
  espacoPorCodigo,
  esperarAviso,
  funcionarioPorEmail,
  garantirEspacoDeTeste,
  hoje,
  irParaAdmin,
  limparAvisos,
  limparReservas,
  linhaDoEspaco,
  metrica,
  nomeDoEspaco,
  pelaApi,
  recarregar,
  reservarPelaApi,
  tentarReservarPelaApi,
} from './apoio';

/**
 * O caminho que importa, do ponto de vista de quem usa o sistema: entrar,
 * cadastrar espaço, reservar parte da capacidade, ver que o resto continuou
 * disponível, aprovar, cancelar — e conferir que tudo isso sobreviveu a um
 * recarregamento, ou seja, está no banco e não na memória do navegador.
 *
 * Cada teste prepara o próprio cenário e não depende de nenhum outro.
 */

/** Espaços que esta execução cria. O prefixo E2E protege o cadastro real. */
const NOVO = `${MARCA}${RUN}A`;
const EXISTENTE = `${MARCA}${RUN}B`;
const COM_RESERVA = `${MARCA}${RUN}C`;
const CHEIO = `${MARCA}${RUN}D`;
const EM_OBRA = `${MARCA}${RUN}E`;
const PARA_APROVAR = `${MARCA}${RUN}F`;

const EMAIL = `e2e.${RUN.toLowerCase()}@embrapa.br`;

test.describe('CVGWeb de ponta a ponta', () => {
  test('entra no sistema e carrega os espaços do banco', async ({ page }) => {
    await abrirSistema(page);

    // Os marcadores do mapa só existem se os espaços chegaram da API.
    await expect(page.locator('.marker').first()).toBeVisible();

    const espacos = await pelaApi<{ data: unknown[] }>(page, '/casas-vegetacao?per_page=5');
    expect(espacos.data.length).toBeGreaterThan(0);
  });

  test('cadastra um espaço pela tela e ele fica gravado', async ({ page }) => {
    await abrirSistema(page);
    await apagarEspacoDeTeste(page, NOVO);
    await irParaAdmin(page);
    await limparAvisos(page);

    await page.locator('#view-admin [data-action="abrir-alterar-espaco"]').click();
    await expect(page.locator('#modal-espaco')).toBeVisible();

    // O código é o campo que identifica a estufa; um código que não existe
    // deixa o formulário em modo de cadastro novo.
    await page.fill('#espaco-codigo', NOVO);
    await expect(page.locator('#espaco-alvo')).toHaveAttribute('data-tom', 'novo');
    await page.fill('#espaco-descricao-campo', 'Estufa criada pelo teste');
    await page.fill('#espaco-tipo', 'Casa de vegetação');
    await page.fill('#espaco-localizacao', 'Setor de testes');
    await page.fill('#espaco-capacidade-total', '20');
    await page.selectOption('#espaco-unidade', 'VASO');
    await page.fill('#espaco-area', '120');
    await page.fill('#espaco-bancadas', '4');
    await page.click('#espaco-enviar');

    await expect(page.locator('#modal-espaco')).toBeHidden();
    expect(await esperarAviso(page, '20 vasos')).toContain(NOVO);

    // Na tabela, com a capacidade toda livre.
    await expect(capacidadeDoEspaco(page, NOVO)).toContainText('20 de 20 vasos livres');
    await expect(linhaDoEspaco(page, NOVO)).toContainText('Livre');

    // E no banco, não só na tela.
    const gravado = await espacoPorCodigo(page, NOVO);
    expect(gravado?.capacidade_total).toBe(20);
    expect(gravado?.status).toBe('ATIVA');
    expect(gravado?.descricao).toBe('Estufa criada pelo teste');
  });

  test('código que já existe passa a ALTERAR aquele espaço, não duplicar', async ({ page }) => {
    await abrirSistema(page);
    await garantirEspacoDeTeste(page, EXISTENTE, 10);
    await recarregar(page);
    await irParaAdmin(page);

    const antes = await pelaApi<{ meta?: { total?: number } }>(page, '/casas-vegetacao?per_page=1');

    await page.locator('#view-admin [data-action="abrir-alterar-espaco"]').click();
    await page.fill('#espaco-codigo', EXISTENTE);

    // O formulário avisa de quem é o cadastro e carrega o que está no banco.
    await expect(page.locator('#espaco-alvo')).toContainText(EXISTENTE);
    await expect(page.locator('#espaco-capacidade-total')).toHaveValue('10');

    await page.fill('#espaco-descricao-campo', 'Nome alterado pelo teste');
    await page.fill('#espaco-capacidade-total', '12');
    await page.click('#espaco-enviar');

    await expect(page.locator('#modal-espaco')).toBeHidden();

    // Alterou o que já existia; não nasceu um segundo espaço com o mesmo código.
    const depois = await espacoPorCodigo(page, EXISTENTE);
    expect(depois?.descricao).toBe('Nome alterado pelo teste');
    expect(depois?.capacidade_total).toBe(12);

    const contagem = await pelaApi<{ meta?: { total?: number } }>(page, '/casas-vegetacao?per_page=1');
    expect(contagem.meta?.total).toBe(antes.meta?.total);
  });

  test('reserva parte da capacidade pela tela e o resto continua disponível', async ({ page }) => {
    await abrirSistema(page);

    // A reserva pela tela só existe no mapa, então usa uma estufa de verdade —
    // sem tocar no cadastro dela, só criando reserva marcada, cancelada depois.
    await limparReservas(page, ESTUFA_REAL);
    const antes = await disponibilidade(page, ESTUFA_REAL);
    expect(antes.disponivel, 'a estufa do teste precisa de pelo menos 10 livres')
      .toBeGreaterThanOrEqual(10);

    await irParaAdmin(page);
    const nome = await nomeDoEspaco(page, ESTUFA_REAL);

    await abrirEspacoNoMapa(page, nome);
    await limparAvisos(page);
    await page.click('#painel-acao');
    await expect(page.locator('#modal-reservar')).toBeVisible();
    await expect(page.locator('#reservar-capacidade')).toContainText(String(antes.disponivel));

    await page.fill('#reservar-data-inicio', hoje());
    await page.fill('#reservar-data-fim', emDias(7));
    await page.fill('#reservar-quantidade', '10');
    await page.fill('#reservar-finalidade', `${MARCA} ${RUN} reserva pela tela`);

    // Antes de enviar, o sistema já avisa quanto sobra no período.
    await expect(page.locator('#reservar-aviso')).toBeVisible();
    await expect(page.locator('#reservar-aviso-texto')).toContainText('vaso');

    await page.click('#reservar-enviar');
    await expect(page.locator('#modal-reservar')).toBeHidden();
    expect(await esperarAviso(page, '10 vasos')).toMatch(/restam|capacidade cheia/i);

    // O banco tem a reserva, com a quantidade certa.
    const reservas = await pelaApi<{ data: { quantidade: number; finalidade: string }[] }>(
      page,
      '/reservas?status=TODAS&per_page=200',
    );
    const minha = reservas.data.find((r) => r.finalidade === `${MARCA} ${RUN} reserva pela tela`);
    expect(minha, 'a reserva deveria estar gravada').toBeTruthy();
    expect(minha!.quantidade).toBe(10);

    // E sobrou exatamente 10 a menos do que havia antes.
    const depois = await disponibilidade(page, ESTUFA_REAL);
    expect(depois.disponivel).toBe(antes.disponivel - 10);

    await irParaAdmin(page);
    await expect(capacidadeDoEspaco(page, ESTUFA_REAL))
      .toContainText(`${depois.disponivel} de ${antes.capacidade_total} vasos livres`);

    await limparReservas(page, ESTUFA_REAL);
  });

  test('a reserva sobrevive ao recarregamento (está no banco, não no navegador)', async ({ page }) => {
    await abrirSistema(page);
    await garantirEspacoDeTeste(page, COM_RESERVA, 20);
    await reservarPelaApi(page, COM_RESERVA, 8, { finalidade: `${MARCA} ${RUN} persistência` });

    // O cenário foi montado por fora, então o front precisa reler.
    await recarregar(page);
    await irParaAdmin(page);
    await expect(capacidadeDoEspaco(page, COM_RESERVA)).toContainText('12 de 20 vasos livres');

    // Recarrega a página inteira: o que não estiver no banco se perde aqui.
    await recarregar(page);
    await irParaAdmin(page);
    await expect(capacidadeDoEspaco(page, COM_RESERVA)).toContainText('12 de 20 vasos livres');

    // E o responsável aparece na coluna "Reservado por", com a quantidade.
    await expect(
      linhaDoEspaco(page, COM_RESERVA).locator('td[data-label="Reservado por"]'),
    ).toContainText('8 vasos');
  });

  test('não deixa reservar mais do que sobrou', async ({ page }) => {
    await abrirSistema(page);
    await garantirEspacoDeTeste(page, CHEIO, 20);
    // Toma a capacidade inteira.
    await reservarPelaApi(page, CHEIO, 20, { ate: emDias(10), finalidade: `${MARCA} ${RUN} lotado` });

    // Pela API, a recusa é 422 com a frase da regra.
    const recusa = await tentarReservarPelaApi(page, CHEIO, 5);
    expect(recusa.status).toBe(422);
    expect(recusa.corpo).toMatch(/capacidade cheia|dispon/i);

    // E na tela o espaço aparece sem nada livre.
    await recarregar(page);
    await irParaAdmin(page);
    await expect(capacidadeDoEspaco(page, CHEIO)).toContainText('0 de 20 vasos livres');
    await expect(linhaDoEspaco(page, CHEIO)).toContainText('Ocupada');
  });

  test('espaço em manutenção não aceita reserva', async ({ page }) => {
    await abrirSistema(page);
    await garantirEspacoDeTeste(page, EM_OBRA, 10);
    await recarregar(page);
    await irParaAdmin(page);
    await limparAvisos(page);

    await linhaDoEspaco(page, EM_OBRA)
      .locator('select[data-change="situacao-espaco"]')
      .selectOption('MANUTENCAO');

    await esperarAviso(page, 'manuten');
    await expect(linhaDoEspaco(page, EM_OBRA)).toContainText('Manutenção');

    // Gravado no banco.
    expect((await espacoPorCodigo(page, EM_OBRA))?.status).toBe('MANUTENCAO');

    // E a reserva é recusada com o motivo.
    const recusa = await tentarReservarPelaApi(page, EM_OBRA, 1);
    expect(recusa.status).toBe(422);
    expect(recusa.corpo).toMatch(/manuten/i);
  });

  test('não reduz a capacidade abaixo do que já está reservado', async ({ page }) => {
    await abrirSistema(page);
    await garantirEspacoDeTeste(page, COM_RESERVA, 20);
    await reservarPelaApi(page, COM_RESERVA, 12, { ate: emDias(20), finalidade: `${MARCA} ${RUN} fixa` });

    await recarregar(page);
    await irParaAdmin(page);
    await linhaDoEspaco(page, COM_RESERVA).locator('[data-action="editar-espaco"]').click();
    await expect(page.locator('#modal-espaco')).toBeVisible();

    await page.fill('#espaco-capacidade-total', '5');
    await page.click('#espaco-enviar');

    // O back-end recusa e explica quanto já está em uso.
    await expect(page.locator('#espaco-erro')).toBeVisible();
    await expect(page.locator('#espaco-erro-texto')).toContainText('capacidade');

    // A capacidade no banco não mudou.
    expect((await espacoPorCodigo(page, COM_RESERVA))?.capacidade_total).toBe(20);
  });

  test('o painel mostra os números que a API calcula', async ({ page }) => {
    await abrirSistema(page);
    await irParaAdmin(page);

    await page.locator('#view-admin [data-action="abrir-painel-metricas"]').click();
    await expect(page.locator('#modal-metricas')).toBeVisible();

    const total = await metrica(page, 'm-total');
    const livres = await metrica(page, 'm-livres');
    const manutencao = await metrica(page, 'm-manutencao');

    // Pelo menos as 50 estufas do Cenargen.
    expect(total).toBeGreaterThanOrEqual(50);
    expect(livres + manutencao).toBeLessThanOrEqual(total);

    // Os números da tela são os do back-end, não contas do navegador.
    const painel = await pelaApi<{
      metricas: { total_espacos: number; livres: number; manutencao: number };
    }>(page, '/painel');

    expect(painel.metricas.total_espacos).toBe(total);
    expect(painel.metricas.livres).toBe(livres);
    expect(painel.metricas.manutencao).toBe(manutencao);
  });

  test('cadastra usuário sem senha e com convite pendente', async ({ page }) => {
    await abrirSistema(page);
    await apagarFuncionario(page, EMAIL);
    await irParaAdmin(page);
    await limparAvisos(page);

    await page.locator('#view-admin [data-action="abrir-novo-usuario"]').click();
    await expect(page.locator('#modal-novo-usuario')).toBeVisible();
    await page.fill('#novo-usuario-email', EMAIL);
    await page.click('#novo-usuario-enviar');

    // A mensagem do back-end diz para onde o convite foi.
    expect(await esperarAviso(page, EMAIL)).toMatch(/48 horas|link|senha/i);

    // O banco concorda: usuário sem senha, convite pendente.
    expect((await funcionarioPorEmail(page, EMAIL))?.situacao).toBe('CONVITE_PENDENTE');

    // E ele aparece marcado na lista.
    await expect(page.locator('.user-card', { hasText: EMAIL.split('@')[0] })).toContainText('sem senha');
  });

  test('login é recusado para quem ainda não criou a senha', async ({ page }) => {
    await abrirSistema(page);
    const usuario = await criarFuncionarioSemSenha(page, EMAIL);

    // Sai da sessão e tenta entrar como o convidado.
    await page.evaluate(() => {
      localStorage.removeItem('cvgweb:token');
      localStorage.removeItem('cvgweb:sessao');
    });
    await page.goto('/');

    await expect(page.locator('#tela-entrada')).toBeVisible();
    await page.fill('#entrada-usuario', usuario.nick);
    await page.fill('#entrada-senha', 'qualquer-coisa');
    await page.click('#entrada-enviar');

    // A API explica o caso em vez de dar o erro genérico.
    await expect(page.locator('#entrada-erro')).toBeVisible();
    await expect(page.locator('#entrada-erro-texto')).toContainText('convite');
    await expect(page.locator('#app')).toBeHidden();
  });

  test('aprovar e cancelar reserva muda o banco e devolve a capacidade', async ({ page }) => {
    await abrirSistema(page);
    await garantirEspacoDeTeste(page, PARA_APROVAR, 20);

    const finalidade = `${MARCA} ${RUN} aprovação`;
    await reservarPelaApi(page, PARA_APROVAR, 6, { status: 'PENDENTE', finalidade });

    await recarregar(page);
    await irParaAdmin(page);
    await expect(capacidadeDoEspaco(page, PARA_APROVAR)).toContainText('14 de 20 vasos livres');

    await page.locator('#view-admin [data-action="abrir-reservas"]').click();
    await expect(page.locator('#modal-reservas')).toBeVisible();

    // A tabela de reservas mostra o espaço, não a finalidade: localiza pelo
    // código do espaço, que é único nesta execução.
    const linha = page.locator('#tbody-reservas tr', { hasText: PARA_APROVAR }).first();
    await expect(linha).toBeVisible();
    await expect(linha).toContainText('6 vasos');
    await expect(linha).toContainText('Pendente');

    // Aprovar: PENDENTE -> ATIVA, com rastro no banco.
    await limparAvisos(page);
    await linha.locator('[data-action="aprovar-reserva"]').click();
    await esperarAviso(page, 'aprovada');

    const depoisDeAprovar = await pelaApi<{
      data: { finalidade: string; status: string; aprovada_em: string | null }[];
    }>(page, '/reservas?status=TODAS&per_page=200');
    const aprovada = depoisDeAprovar.data.find((r) => r.finalidade === finalidade);
    expect(aprovada?.status).toBe('ATIVA');
    expect(aprovada?.aprovada_em).not.toBeNull();

    // Cancelar devolve a capacidade.
    await limparAvisos(page);
    await page.locator('#tbody-reservas tr', { hasText: PARA_APROVAR }).first()
      .locator('[data-action="cancelar-reserva"]').click();
    await page.locator('[data-confirmar="sim"]').click();
    await esperarAviso(page, 'cancelada');

    await page.locator('#modal-reservas [data-action="fechar"]').click();
    await expect(capacidadeDoEspaco(page, PARA_APROVAR)).toContainText('20 de 20 vasos livres');

    const canceladas = await pelaApi<{ data: { finalidade: string }[] }>(
      page,
      '/reservas?status=CANCELADA&per_page=200',
    );
    expect(canceladas.data.some((r) => r.finalidade === finalidade)).toBe(true);
  });
});

test.describe('limpeza', () => {
  test('remove o que a suíte criou', async ({ page }) => {
    await abrirSistema(page);

    await limparReservas(page, ESTUFA_REAL);

    for (const codigo of [NOVO, EXISTENTE, COM_RESERVA, CHEIO, EM_OBRA, PARA_APROVAR]) {
      await apagarEspacoDeTeste(page, codigo);
    }

    await apagarFuncionario(page, EMAIL);

    // O cadastro real continua intacto: nenhuma reserva marcada sobrou.
    const sobrou = await pelaApi<{ data: { finalidade: string }[] }>(
      page,
      '/reservas?em_aberto=1&per_page=200',
    );
    expect(sobrou.data.filter((r) => r.finalidade?.includes(MARCA))).toHaveLength(0);

    // E nenhum espaço de teste ficou contando como disponível no painel.
    const espacos = await pelaApi<{ data: { codigo: string; status: string }[] }>(
      page,
      `/casas-vegetacao?busca=${MARCA}&per_page=200`,
    );
    for (const espaco of espacos.data.filter((e) => e.codigo.startsWith(MARCA))) {
      expect(espaco.status, `${espaco.codigo} deveria estar inativo`).toBe('INATIVA');
    }
  });
});
