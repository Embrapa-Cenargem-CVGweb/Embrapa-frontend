import { expect, type Page } from '@playwright/test';

/**
 * Apoio dos testes de ponta a ponta.
 *
 * Nada de atalho por dentro: os testes entram pela tela de login, clicam no
 * mapa e preenchem os mesmos formulários que uma pessoa preencheria. O que
 * interessa é o comportamento do sistema inteiro — front, API e banco.
 *
 * A API só é usada para duas coisas: **preparar** o cenário de cada teste e
 * **conferir por fora** o que ficou gravado. Nunca para executar o que está
 * sendo testado.
 *
 * Duas regras de segurança, porque esta suíte pode rodar contra um banco com
 * dado de verdade:
 *
 * 1. Toda estufa que o teste cria tem o prefixo `E2E` no código, e o cadastro
 *    das estufas do Cenargen nunca é alterado (nem nome, nem capacidade).
 * 2. A limpeza só cancela reservas cuja finalidade traz a marca `E2E`.
 *
 * Cada teste prepara o próprio cenário: nada depende da ordem nem do que
 * outro teste deixou para trás — o Playwright pode reiniciar o processo de
 * teste no meio da execução.
 */

/** Onde a sessão compartilhada entre os testes é guardada. */
export const ARQUIVO_SESSAO = 'tests/e2e/.auth/sessao.json';

export const CREDENCIAIS = {
  nick: process.env.CVG_NICK ?? 'SU',
  senha: process.env.CVG_SENHA ?? 'super123',
};

export const API = process.env.CVG_API ?? 'http://localhost:8000/api';

/**
 * Identificador desta execução, usado nos códigos e e-mails criados. Vem do
 * ambiente para ser o mesmo em todos os testes, inclusive se o processo de
 * teste reiniciar no meio.
 */
export const RUN = process.env.CVG_RUN ?? 'T1';

/** Marca que identifica tudo que a suíte cria. Nada fora disso é tocado. */
export const MARCA = 'E2E';

/**
 * Estufa do cadastro real usada para exercitar a reserva pela tela — é a única
 * real que a suíte toca, e só com reservas, que ela mesma cancela no fim. O
 * cadastro dela não é alterado. Precisa ter marcador no mapa (CVG01..CVG50).
 */
export const ESTUFA_REAL = process.env.CVG_ESTUFA ?? 'CVG50';

/* ===========================================================================
   Sessão e navegação
   =========================================================================== */

/**
 * Entra no sistema, se ainda não estiver dentro.
 *
 * A sessão fica no localStorage: depois de um reload o app monta sozinho e a
 * tela de login nem aparece — tentar preenchê-la travava o teste.
 */
export async function entrar(page: Page): Promise<void> {
  if (!page.url().startsWith('http')) await page.goto('/');

  const app = page.locator('#app');
  if (await app.isVisible().catch(() => false)) return;

  await expect(page.locator('#tela-entrada')).toBeVisible();
  await page.fill('#entrada-usuario', CREDENCIAIS.nick);
  await page.fill('#entrada-senha', CREDENCIAIS.senha);
  await page.click('#entrada-enviar');

  await expect(app).toBeVisible();
  await expect(page.locator('#tela-entrada')).toBeHidden();
}

/** Abre o sistema já logado, com o coletor de avisos armado. */
export async function abrirSistema(page: Page): Promise<void> {
  await coletarAvisos(page);
  await page.goto('/');
  await entrar(page);
}

/**
 * Recarrega a página e volta para a sessão.
 *
 * Necessário depois de montar cenário pela API: o front carrega os espaços uma
 * vez, ao entrar, então uma estufa criada por fora só aparece na tela depois de
 * ele reler. (Quando a própria tela cria ou altera algo, ela já relê sozinha.)
 */
export async function recarregar(page: Page): Promise<void> {
  await page.reload();
  await entrar(page);
}

export async function irParaAdmin(page: Page): Promise<void> {
  await page.click('#nav-admin');
  await expect(page.locator('#sec-espacos')).toBeVisible();
}

export async function irParaMapa(page: Page): Promise<void> {
  await page.click('#nav-mapa');
  await expect(page.locator('.marker').first()).toBeVisible();
}

/* ===========================================================================
   Avisos (toasts)
   =========================================================================== */

/**
 * Os avisos somem depois de ~4 s, o que torna frágil esperar por eles. Este
 * observador empilha o texto de cada um em `window.__avisos` assim que
 * aparece, para o teste conferir sem corrida.
 */
export async function coletarAvisos(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const janela = window as unknown as { __avisos: string[] };
    janela.__avisos = [];

    const observar = (): void => {
      const alvo = document.getElementById('toasts');
      if (!alvo) {
        window.setTimeout(observar, 50);
        return;
      }
      new MutationObserver((mudancas) => {
        for (const m of mudancas) {
          m.addedNodes.forEach((n) => {
            if (n instanceof HTMLElement) janela.__avisos.push(n.textContent?.trim() ?? '');
          });
        }
      }).observe(alvo, { childList: true });
    };

    observar();
  });
}

export async function avisos(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __avisos: string[] }).__avisos ?? []);
}

export async function limparAvisos(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __avisos: string[] }).__avisos = [];
  });
}

/** Espera um aviso que contenha o trecho informado e devolve o texto dele. */
export async function esperarAviso(page: Page, trecho: RegExp | string): Promise<string> {
  const combina = (t: string): boolean =>
    typeof trecho === 'string' ? t.toLowerCase().includes(trecho.toLowerCase()) : trecho.test(t);

  let achado = '';

  await expect
    .poll(async () => {
      achado = (await avisos(page)).find(combina) ?? '';
      return achado !== '';
    }, { message: `nenhum aviso correspondeu a ${trecho}`, timeout: 15_000 })
    .toBe(true);

  return achado;
}

/* ===========================================================================
   Localizadores
   =========================================================================== */

/** A linha da tabela de espaços de um código do cadastro (CVG01). */
export function linhaDoEspaco(page: Page, codigo: string) {
  return page.locator('#tbody-espacos tr', { has: page.locator(`.code:text-is("${codigo}")`) });
}

/** A célula de capacidade daquela linha ("12 de 20 vasos livres"). */
export function capacidadeDoEspaco(page: Page, codigo: string) {
  return linhaDoEspaco(page, codigo).locator('td[data-label="Capacidade"]');
}

/** O nome do espaço como a tabela mostra — serve para achar o marcador. */
export async function nomeDoEspaco(page: Page, codigo: string): Promise<string> {
  const texto = await linhaDoEspaco(page, codigo).locator('td[data-label="Nome"]').textContent();
  return (texto ?? '').trim();
}

/** Abre a ficha de um espaço pelo marcador do mapa. */
export async function abrirEspacoNoMapa(page: Page, nome: string): Promise<void> {
  await irParaMapa(page);
  await page.locator(`.marker[aria-label^="${nome},"]`).click();
  await expect(page.locator('#painel')).toHaveClass(/is-open/);
}

/** Lê um número de uma métrica do painel (m-total, m-livres...). */
export async function metrica(page: Page, id: string): Promise<number> {
  const texto = (await page.locator(`#${id}`).textContent()) ?? '0';
  return Number.parseInt(texto.replace(/\D/g, ''), 10) || 0;
}

/* ===========================================================================
   API: preparar o cenário e conferir o resultado
   =========================================================================== */

async function token(page: Page): Promise<string> {
  const t = await page.evaluate(() => localStorage.getItem('cvgweb:token'));
  expect(t, 'o navegador deveria ter um token de sessão').toBeTruthy();
  return t as string;
}

async function chamar<T>(
  page: Page,
  metodo: 'get' | 'post' | 'patch' | 'put' | 'delete',
  caminho: string,
  corpo?: unknown,
  tolerarErro = false,
): Promise<T> {
  const resposta = await page.request[metodo](`${API}${caminho}`, {
    headers: { Authorization: `Bearer ${await token(page)}`, Accept: 'application/json' },
    ...(corpo === undefined ? {} : { data: corpo }),
  });

  if (!tolerarErro) {
    expect(
      resposta.ok(),
      `${metodo.toUpperCase()} ${caminho} devolveu ${resposta.status()}: ${await resposta.text()}`,
    ).toBeTruthy();
  }

  return resposta.json().catch(() => ({})) as Promise<T>;
}

export function pelaApi<T = unknown>(page: Page, caminho: string): Promise<T> {
  return chamar<T>(page, 'get', caminho);
}

export interface EspacoApi {
  id: number;
  codigo: string;
  descricao: string;
  capacidade_total: number;
  status: string;
  unidade_capacidade: string;
}

export async function espacoPorCodigo(page: Page, codigo: string): Promise<EspacoApi | null> {
  const r = await pelaApi<{ data: EspacoApi[] }>(page, `/casas-vegetacao?busca=${codigo}`);
  return r.data.find((c) => c.codigo === codigo) ?? null;
}

/**
 * Garante um espaço EXCLUSIVO do teste, criando ou ajustando.
 * Recusa qualquer código sem o prefixo E2E, justamente para não encostar nas
 * estufas do Cenargen.
 */
export async function garantirEspacoDeTeste(
  page: Page,
  codigo: string,
  capacidadeTotal: number,
  status: 'ATIVA' | 'MANUTENCAO' | 'INATIVA' = 'ATIVA',
): Promise<EspacoApi> {
  expect(codigo.startsWith(MARCA), 'espaço de teste precisa do prefixo E2E').toBe(true);

  await limparReservas(page, codigo);

  const corpo = {
    codigo,
    descricao: `Espaço de teste ${codigo}`,
    tipo: 'Casa de vegetação',
    localizacao: 'Setor de testes',
    unidade_capacidade: 'VASO',
    capacidade_total: capacidadeTotal,
    status,
  };

  const atual = await espacoPorCodigo(page, codigo);

  if (atual) await chamar(page, 'put', `/casas-vegetacao/${atual.id}`, corpo);
  else await chamar(page, 'post', '/casas-vegetacao', corpo);

  const depois = await espacoPorCodigo(page, codigo);
  expect(depois, `o espaço ${codigo} deveria existir`).toBeTruthy();
  return depois as EspacoApi;
}

/** Disponibilidade de hoje, direto da API. */
export async function disponibilidade(
  page: Page,
  codigo: string,
): Promise<{ disponivel: number; capacidade_total: number; ocupado: number }> {
  const espaco = await espacoPorCodigo(page, codigo);
  expect(espaco, `o espaço ${codigo} deveria existir`).toBeTruthy();

  return pelaApi(page, `/casas-vegetacao/${espaco!.id}/disponibilidade?de=${hoje()}&ate=${hoje()}`);
}

/** Cria uma reserva pela API, só para montar o cenário do teste. */
export async function reservarPelaApi(
  page: Page,
  codigo: string,
  quantidade: number,
  opcoes: { de?: string; ate?: string; finalidade?: string } = {},
): Promise<{ id: number }> {
  const espaco = await espacoPorCodigo(page, codigo);
  expect(espaco).toBeTruthy();

  // O status nao vai no corpo: quem decide e a API, e toda reserva nova nasce
  // PENDENTE. Mandar `status: 'ATIVA'` daqui nao fazia nada — o controller
  // ignora o campo — e dava a impressao de montar um cenario que nao existia.
  const r = await chamar<{ data: { id: number } }>(page, 'post', '/reservas', {
    casa_vegetacao_id: espaco!.id,
    quantidade,
    data_inicio: opcoes.de ?? hoje(),
    data_fim: opcoes.ate ?? emDias(5),
    finalidade: opcoes.finalidade ?? `${MARCA} ${RUN} cenário`,
  });

  return r.data;
}

/** Tenta reservar pela API e devolve o status HTTP — para testar a recusa. */
export async function tentarReservarPelaApi(
  page: Page,
  codigo: string,
  quantidade: number,
  de = hoje(),
  ate = emDias(3),
): Promise<{ status: number; corpo: string }> {
  const espaco = await espacoPorCodigo(page, codigo);
  expect(espaco).toBeTruthy();

  const resposta = await page.request.post(`${API}/reservas`, {
    headers: { Authorization: `Bearer ${await token(page)}`, Accept: 'application/json' },
    data: {
      casa_vegetacao_id: espaco!.id,
      quantidade,
      data_inicio: de,
      data_fim: ate,
      finalidade: `${MARCA} ${RUN} tentativa`,
    },
  });

  return { status: resposta.status(), corpo: await resposta.text() };
}

/**
 * Cancela as reservas que os TESTES criaram num espaço — e só elas. O filtro
 * pela marca existe para a suíte poder rodar contra um banco com dado de
 * verdade sem cancelar a reserva de ninguém.
 */
export async function limparReservas(page: Page, codigo: string): Promise<void> {
  const espaco = await espacoPorCodigo(page, codigo);
  if (!espaco) return;

  const r = await pelaApi<{ data: { id: number; finalidade: string }[] }>(
    page,
    `/reservas?casa_vegetacao_id=${espaco.id}&em_aberto=1&per_page=200`,
  );

  for (const reserva of r.data) {
    if (!reserva.finalidade?.includes(MARCA)) continue;
    await chamar(page, 'post', `/reservas/${reserva.id}/cancelar`, { motivo: 'limpeza do teste' }, true);
  }
}

/**
 * Apaga um espaço de teste. Recusa apagar o que não for marcado.
 *
 * O sistema não deixa excluir espaço que tenha qualquer reserva no histórico,
 * nem cancelada — e com razão, senão o histórico ficaria órfão. Quando é o
 * caso, o espaço é marcado como INATIVA, para não contar no painel nem
 * aparecer como disponível.
 */
export async function apagarEspacoDeTeste(page: Page, codigo: string): Promise<void> {
  expect(codigo.startsWith(MARCA), 'só espaço de teste pode ser apagado').toBe(true);

  const espaco = await espacoPorCodigo(page, codigo);
  if (!espaco) return;

  await limparReservas(page, codigo);
  await chamar(page, 'delete', `/casas-vegetacao/${espaco.id}`, undefined, true);

  if (await espacoPorCodigo(page, codigo)) {
    await chamar(page, 'patch', `/casas-vegetacao/${espaco.id}/situacao`, { status: 'INATIVA' }, true);
  }
}

export interface FuncionarioApi {
  id: number;
  nome: string;
  nick: string;
  email: string;
  situacao?: string;
}

export async function funcionarioPorEmail(page: Page, email: string): Promise<FuncionarioApi | null> {
  const r = await pelaApi<{ data: FuncionarioApi[] }>(page, `/funcionarios?busca=${email}`);
  return r.data.find((f) => f.email === email) ?? null;
}

/** Apaga o usuário de teste, se existir e se o sistema permitir. */
export async function apagarFuncionario(page: Page, email: string): Promise<void> {
  const funcionario = await funcionarioPorEmail(page, email);
  if (!funcionario) return;

  await chamar(page, 'delete', `/funcionarios/${funcionario.id}`, undefined, true);
}

/** Cria, pela API, um usuário sem senha (convite pendente). */
export async function criarFuncionarioSemSenha(page: Page, email: string): Promise<FuncionarioApi> {
  const existente = await funcionarioPorEmail(page, email);
  if (existente) return existente;

  const nick = email.split('@')[0];
  await chamar(page, 'post', '/funcionarios', {
    nome: `Teste ${nick}`,
    nick,
    email,
    perfil: '/FUNCIONARIO-C/',
  });

  const criado = await funcionarioPorEmail(page, email);
  expect(criado, 'o usuário deveria ter sido criado').toBeTruthy();
  return criado as FuncionarioApi;
}

/* ===========================================================================
   Datas
   =========================================================================== */

export function iso(data: Date): string {
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${data.getFullYear()}-${mes}-${dia}`;
}

export function hoje(): string {
  return iso(new Date());
}

export function emDias(dias: number): string {
  return iso(new Date(Date.now() + dias * 86_400_000));
}
