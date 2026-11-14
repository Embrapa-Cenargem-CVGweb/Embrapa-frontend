/**
 * Calendário de ocupação, no jeito do calendário do Teams.
 *
 * Três modos:
 * - Semana e 2 semanas: linha do tempo com uma faixa por estufa. Cada reserva
 *   é uma barra do dia em que começa até o dia em que termina; reservas que se
 *   cruzam vão uma embaixo da outra; embaixo de cada dia, quantos vasos (ou
 *   bancadas) sobram.
 * - Mês: o mês inteiro de UMA estufa, com as reservas atravessando os dias e
 *   o que sobra em cada dia.
 *
 * Cores iguais às do mapa: laranja é reserva aprovada, azul é pedido que
 * aguarda a administração, listrado vermelho é estufa fora de uso. Nenhum
 * estado depende só da cor: pendente tem contorno tracejado e o texto
 * "aguardando", lotada mostra o 0, e toda barra e todo dia têm a frase
 * completa no rótulo.
 *
 * Tudo sai de uma consulta só (`/casas-vegetacao/calendario`), que traz as
 * estufas e as reservas que cruzam o intervalo. A conta por dia é feita aqui,
 * com a mesma regra do back-end: vasos e bancadas são contas separadas, e
 * reserva pendente já segura o espaço.
 */
import type { UnidadeCapacidade } from '../types';
import {
  getCalendario,
  type CalendarioOcupacao,
  type CasaDoCalendario,
  type ReservaDoCalendario,
} from '../services/api';
import { ID_REAL_ESPACO, reservas as reservasDoEstado } from '../data/estufas';
import { motivoParaNaoReservar } from '../data/contexto';
import { aoMudar } from '../lib/bus';
import { debounce, el, qs, qsa, setText, show } from '../lib/dom';
import { capacidade, dataBR, hojeISO, plural } from '../lib/format';
import { html, icone, juntar, raw } from '../lib/html';
import { abrirModal, fecharModal, modalAberto } from '../lib/modal';
import { aviso } from '../lib/toast';
import { abrirModalReservar, verReserva } from './reservas';

/* ===========================================================================
   Datas — sempre AAAA-MM-DD, contas em UTC para o fuso não mexer no dia
   =========================================================================== */

const DIA_MS = 86_400_000;

function utc(dia: string): number {
  const [ano, mes, d] = dia.split('-').map(Number);
  return Date.UTC(ano, mes - 1, d);
}

function paraISO(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function somarDias(dia: string, dias: number): string {
  return paraISO(utc(dia) + dias * DIA_MS);
}

/** Quantos dias de `a` até `b` (negativo se `b` vem antes). */
function distancia(a: string, b: string): number {
  return Math.round((utc(b) - utc(a)) / DIA_MS);
}

function diaDaSemana(dia: string): number {
  return new Date(utc(dia)).getUTCDay();
}

/** Domingo da semana do dia: a semana começa no domingo, como no Teams em português. */
function domingoDe(dia: string): string {
  return somarDias(dia, -diaDaSemana(dia));
}

function inicioDoMes(dia: string): string {
  return `${dia.slice(0, 7)}-01`;
}

function fimDoMes(dia: string): string {
  const [ano, m] = dia.split('-').map(Number);
  return paraISO(Date.UTC(ano, m, 0));
}

function mesVizinho(dia: string, passo: number): string {
  const [ano, m] = dia.split('-').map(Number);
  return paraISO(Date.UTC(ano, m - 1 + passo, 1));
}

const FORMATO_MES = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const FORMATO_DIA = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
});
const FORMATO_CURTO = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' });
const NOME_MES = new Intl.DateTimeFormat('pt-BR', { month: 'long', timeZone: 'UTC' });
const SIGLA_DIA = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
const LETRA_DO_DIA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const NOME_DO_DIA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

function maiuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** "12/11" */
function diaMes(dia: string): string {
  return dataBR(dia).slice(0, 5);
}

/** "qui, 12/11" */
function diaCurto(dia: string): string {
  return FORMATO_CURTO.format(utc(dia)).replace('.', '');
}

/* ===========================================================================
   Estado
   =========================================================================== */

type Modo = 'semana' | 'duas' | 'mes';
type Filtro = 'todas' | 'vaga' | 'lotadas' | 'fora';

interface Linha {
  casa: CasaDoCalendario;
  /** Quanto está tomado em cada dia do intervalo carregado, por unidade. */
  tomado: Record<UnidadeCapacidade, number[]>;
  /** A parte do tomado que ainda aguarda aprovação. */
  pendente: Record<UnidadeCapacidade, number[]>;
  /** Dias em que quem está logado tem reserva nesta estufa, por unidade. */
  minha: Record<UnidadeCapacidade, boolean[]>;
}

let modo: Modo = 'duas';
/** Dia que o calendário mostra; o intervalo sai dele e do modo. */
let ancora = hojeISO();
/** Mês do mini calendário, que anda sozinho sem mexer na grade. */
let mesDoMini = inicioDoMes(ancora);
let unidade: UnidadeCapacidade = 'VASO';
let filtro: Filtro = 'todas';
let busca = '';
/** Estufa da visão de mês (id do cadastro). */
let estufaDoMes: number | null = null;
/** De onde se entrou no mês, para o "voltar" devolver ao mesmo modo. */
let modoAntesDoMes: Exclude<Modo, 'mes'> = 'duas';
/** Ao voltar do mês, a grade rola até a estufa que estava aberta. */
let rolarParaEstufa: number | null = null;

let dados: CalendarioOcupacao | null = null;
let linhas: Linha[] = [];
let falhou = false;
let pedido = 0;
let ligado = false;
/** Dia aberto no modal de detalhe. */
let diaAberto: { casa: number; dia: string } | null = null;
/** Barra que abriu o cartão: o foco volta para ela ao fechar. */
let barraDoCartao: HTMLElement | null = null;
/** Quando o cartão abriu: a rolagem que vem logo junto (foco, ajuste) não o fecha. */
let cartaoAbertoEm = 0;

/** Primeiro e último dia mostrados. No mês, a grade vai de domingo a sábado. */
function intervalo(): { de: string; ate: string } {
  if (modo === 'mes') {
    return { de: domingoDe(inicioDoMes(ancora)), ate: somarDias(domingoDe(fimDoMes(ancora)), 6) };
  }
  const de = domingoDe(ancora);
  return { de, ate: somarDias(de, modo === 'semana' ? 6 : 13) };
}

function diasDe(de: string, ate: string): string[] {
  const dias: string[] = [];
  for (let dia = de; dia <= ate; dia = somarDias(dia, 1)) dias.push(dia);
  return dias;
}

/* ===========================================================================
   Contas de ocupação
   =========================================================================== */

function montarLinhas(resposta: CalendarioOcupacao): Linha[] {
  const dias = distancia(resposta.de, resposta.ate) + 1;
  const zeros = (): number[] => new Array<number>(dias).fill(0);

  return resposta.casas.map((casa) => {
    const linha: Linha = {
      casa,
      tomado: { VASO: zeros(), BANCADA: zeros() },
      pendente: { VASO: zeros(), BANCADA: zeros() },
      minha: { VASO: new Array<boolean>(dias).fill(false), BANCADA: new Array<boolean>(dias).fill(false) },
    };

    for (const r of casa.reservas) {
      const de = Math.max(0, distancia(resposta.de, r.inicio));
      const ate = Math.min(dias - 1, distancia(resposta.de, r.fim));
      const u = unidadeDe(r);

      for (let i = de; i <= ate; i += 1) {
        linha.tomado[u][i] += r.quantidade;
        if (r.status === 'PENDENTE') linha.pendente[u][i] += r.quantidade;
        if (r.minha) linha.minha[u][i] = true;
      }
    }

    return linha;
  });
}

function unidadeDe(r: ReservaDoCalendario): UnidadeCapacidade {
  return r.unidade === 'BANCADA' ? 'BANCADA' : 'VASO';
}

interface Situacao {
  /** null = a estufa não tem esta unidade para reservar. */
  cap: number | null;
  tomado: number;
  pendente: number;
  livre: number;
  /** Mais reservado do que cabe (a capacidade foi reduzida depois, por exemplo). */
  conflito: boolean;
}

function noDia(linha: Linha, dia: string, u: UnidadeCapacidade): Situacao {
  const cap = linha.casa.capacidades[u] ?? null;
  const i = dados ? distancia(dados.de, dia) : -1;
  const tomado = linha.tomado[u][i] ?? 0;
  const pendente = linha.pendente[u][i] ?? 0;

  return {
    cap,
    tomado,
    pendente,
    livre: cap === null ? 0 : Math.max(0, cap - tomado),
    conflito: cap !== null && tomado > cap,
  };
}

/** Lotada só com as aprovadas (laranja) ou com pedido pendente no meio (azul)? */
function lotadaPorAprovadas(s: Situacao): boolean {
  return s.cap !== null && s.tomado - s.pendente >= s.cap;
}

/** O dia de referência dos resumos: hoje, se está na tela; senão, o primeiro dia mostrado. */
function diaDeReferencia(): string {
  const hoje = hojeISO();
  const { de, ate } = intervalo();
  return hoje >= de && hoje <= ate ? hoje : de;
}

type Classe = 'vaga' | 'lotada' | 'fora' | 'sem';

function classificar(linha: Linha): Classe {
  if (!linha.casa.aceita_reserva) return 'fora';
  const s = noDia(linha, diaDeReferencia(), unidade);
  if (s.cap === null) return 'sem';
  return s.livre > 0 ? 'vaga' : 'lotada';
}

const ROTULO_DA_SITUACAO: Record<string, string> = {
  MANUTENCAO: 'Manutenção',
  INATIVA: 'Inativa',
  RESERVADA: 'Bloqueada',
  OCUPADA: 'Bloqueada',
};

function nomeDaUnidade(u: UnidadeCapacidade, n = 2): string {
  if (u === 'BANCADA') return n === 1 ? 'bancada' : 'bancadas';
  return n === 1 ? 'vaso' : 'vasos';
}

function nomeDaCasa(casa: CasaDoCalendario): string {
  return casa.descricao ?? casa.codigo;
}

function codigoDaReserva(id: number): string {
  return `R${String(id).padStart(3, '0')}`;
}

/**
 * Distribui as reservas em trilhas: a que cruza outra desce uma linha. Devolve
 * cada reserva com a trilha dela (0, 1, 2...) e quantas trilhas foram usadas.
 */
function emTrilhas<T extends { inicio: string; fim: string }>(itens: T[]): { item: T; trilha: number }[] {
  const fins: string[] = [];
  return [...itens]
    .sort((a, b) => a.inicio.localeCompare(b.inicio) || b.fim.localeCompare(a.fim))
    .map((item) => {
      let trilha = 0;
      while (fins[trilha] !== undefined && fins[trilha] >= item.inicio) trilha += 1;
      fins[trilha] = item.fim;
      return { item, trilha };
    });
}

/* ===========================================================================
   Carga
   =========================================================================== */

/** Entrada da tela: chamada toda vez que a seção é aberta. */
export function mostrarCalendario(): void {
  ligar();
  pintarControles();
  void carregar();
}

async function carregar(): Promise<void> {
  const { de, ate } = intervalo();
  const meu = ++pedido;
  el('cal-wrap')?.setAttribute('aria-busy', 'true');

  try {
    const resposta = await getCalendario(de, ate);
    if (meu !== pedido) return; // já pediram outro intervalo

    dados = resposta;
    linhas = montarLinhas(resposta);
    falhou = false;
  } catch (erro) {
    if (meu !== pedido) return;
    console.error('[CVGWeb] falha ao carregar o calendário:', erro);
    falhou = true;
  } finally {
    if (meu === pedido) el('cal-wrap')?.removeAttribute('aria-busy');
  }

  pintar();
}

/** Os dados carregados cobrem o que vai ser mostrado? Senão, busca de novo. */
function garantirCobertura(): void {
  const { de, ate } = intervalo();
  pintarControles();
  if (dados && dados.de <= de && dados.ate >= ate) pintar();
  else void carregar();
}

/* ===========================================================================
   Pintura: controles e painel lateral
   =========================================================================== */

function tituloDoIntervalo(): string {
  if (modo === 'mes') return maiuscula(FORMATO_MES.format(utc(ancora)));

  const { de, ate } = intervalo();
  const [, , d1] = de.split('-').map(Number);
  const [a2, , d2] = ate.split('-').map(Number);
  if (de.slice(0, 7) === ate.slice(0, 7)) {
    return `${d1} – ${d2} de ${NOME_MES.format(utc(de))} de ${a2}`;
  }
  const mesmoAno = de.slice(0, 4) === ate.slice(0, 4);
  return `${d1} de ${NOME_MES.format(utc(de))}${mesmoAno ? '' : ` de ${de.slice(0, 4)}`} – ${d2} de ${NOME_MES.format(utc(ate))} de ${a2}`;
}

function pintarControles(): void {
  setText('cal-titulo', tituloDoIntervalo());

  for (const botao of qsa<HTMLButtonElement>('[data-action="cal-unidade"]')) {
    botao.setAttribute('aria-checked', String(botao.dataset.unidade === unidade));
  }
  for (const botao of qsa<HTMLButtonElement>('[data-action="cal-modo"]')) {
    botao.setAttribute('aria-checked', String(botao.dataset.modo === modo));
  }

  // No mês o assunto é uma estufa: a lista dela toma o lugar dos filtros.
  show(el('cal-estufa-btn'), modo === 'mes');
  show(el('cal-caixa-filtros'), modo !== 'mes');
  show(el('cal-caixa-estufas'), modo === 'mes');

  pintarMini();
}

/** Mini calendário do mês, como o do Teams: o intervalo mostrado fica marcado. */
function pintarMini(): void {
  const alvo = el('cal-mini');
  if (!alvo) return;

  setText('cal-mini-titulo', maiuscula(FORMATO_MES.format(utc(mesDoMini))));

  const hoje = hojeISO();
  const { de, ate } = intervalo();
  const inicio = domingoDe(mesDoMini);
  const mes = mesDoMini.slice(0, 7);

  const cabecalho = LETRA_DO_DIA.map((l, i) => html`<abbr class="cal-mini__letra" title="${NOME_DO_DIA[i]}">${l}</abbr>`);
  const dias = diasDe(inicio, somarDias(inicio, 41)).map((dia) => {
    const atributos = [
      dia === hoje ? 'data-hoje' : '',
      dia >= de && dia <= ate ? 'data-mostrado' : '',
      dia.slice(0, 7) !== mes ? 'data-fora' : '',
    ].filter(Boolean).join(' ');
    return html`
      <button type="button" class="cal-mini__dia" ${raw(atributos)} data-action="cal-ir" data-dia="${dia}"
              aria-label="${maiuscula(FORMATO_DIA.format(utc(dia)))}">${Number(dia.slice(8))}</button>`;
  });

  alvo.innerHTML = juntar([...cabecalho, ...dias]);
}

function pintarFiltros(): void {
  const alvo = el('cal-filtros');
  if (!alvo) return;

  const contagem = { todas: linhas.length, vaga: 0, lotadas: 0, fora: 0 };
  for (const linha of linhas) {
    const c = classificar(linha);
    if (c === 'vaga') contagem.vaga += 1;
    if (c === 'lotada') contagem.lotadas += 1;
    if (c === 'fora') contagem.fora += 1;
  }

  const quando = diaDeReferencia() === hojeISO() ? 'hoje' : `em ${diaMes(diaDeReferencia())}`;
  const opcoes: [Filtro, string][] = [
    ['todas', 'Todas as estufas'],
    ['vaga', `Com vaga ${quando}`],
    ['lotadas', `Lotadas ${quando}`],
    ['fora', 'Fora de uso'],
  ];

  alvo.innerHTML = juntar(opcoes.map(([valor, rotulo]) => html`
    <button type="button" class="cal-filtro" role="radio" aria-checked="${String(filtro === valor)}"
            data-action="cal-filtro" data-filtro="${valor}">
      <span class="cal-filtro__marca" aria-hidden="true"></span>
      <span class="cal-filtro__nome">${rotulo}</span>
      <span class="count">${String(contagem[valor])}</span>
    </button>`));
}

/** Na visão de mês: a lista de estufas para trocar, com o que sobra hoje. */
function pintarListaDeEstufas(): void {
  const alvo = el('cal-estufas');
  if (!alvo) return;

  const hoje = hojeISO();
  alvo.innerHTML = juntar(linhasVisiveis().map((linha) => {
    const s = noDia(linha, hoje, unidade);
    const fora = !linha.casa.aceita_reserva;
    const texto = fora ? '—' : s.cap === null ? '—' : `${s.livre}/${s.cap}`;
    const tom = fora ? 'fora' : s.cap !== null && s.livre === 0 ? (lotadaPorAprovadas(s) ? 'ATIVA' : 'PENDENTE') : 'livre';
    return html`
      <button type="button" class="cal-estufa" data-action="cal-escolher-estufa" data-casa="${linha.casa.id}"
              aria-current="${String(linha.casa.id === estufaDoMes)}">
        <span class="cal-estufa__ponto" data-tom="${tom}" aria-hidden="true"></span>
        <span class="cal-estufa__nome">${nomeDaCasa(linha.casa)}</span>
        <span class="cal-estufa__livre" data-tom="${tom}">${texto}</span>
      </button>`;
  }));
}

function pintarConflitos(): void {
  const { de, ate } = intervalo();
  let conflitos = 0;
  for (const linha of linhas) {
    for (const dia of diasDe(de, ate)) if (noDia(linha, dia, unidade).conflito) conflitos += 1;
  }

  show(el('cal-conflitos'), conflitos > 0);
  if (conflitos > 0) {
    setText(
      'cal-conflitos-texto',
      `${plural(conflitos, 'dia com mais reserva do que cabe', 'dias com mais reserva do que cabe')} na tela. `
        + 'Eles aparecem com “!” — clique no dia para ver quais reservas se cruzam.',
    );
  }
}

/* ===========================================================================
   Pintura: corpo
   =========================================================================== */

function pintar(): void {
  pintarControles();
  fecharCartao(false);

  const corpo = el('cal-corpo');
  if (!corpo) return;

  if (!dados) {
    corpo.innerHTML = html`
      <div class="cal-estado">
        ${raw(falhou
          ? html`Não consegui carregar o calendário.
              <button type="button" class="btn btn--quiet btn--sm" data-action="cal-recarregar">Tentar de novo</button>`
          : 'Carregando o calendário…')}
      </div>`;
    return;
  }

  pintarFiltros();
  pintarConflitos();

  if (modo === 'mes') {
    escolherEstufaPadrao();
    pintarListaDeEstufas();
    pintarMes(corpo);
  } else {
    pintarLinhaDoTempo(corpo);
  }
}

function normalizar(texto: string): string {
  return texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function linhasVisiveis(): Linha[] {
  const alvo = normalizar(busca.trim());
  return linhas.filter((linha) => {
    if (modo !== 'mes') {
      const classe = classificar(linha);
      if (filtro === 'vaga' && classe !== 'vaga') return false;
      if (filtro === 'lotadas' && classe !== 'lotada') return false;
      if (filtro === 'fora' && classe !== 'fora') return false;
    }
    if (!alvo) return true;
    return normalizar(`${linha.casa.codigo} ${linha.casa.descricao ?? ''} ${linha.casa.localizacao ?? ''}`).includes(alvo);
  });
}

/** Frase completa da situação de um dia: vai no rótulo e na dica do quadrinho. */
function rotuloDoDia(linha: Linha, dia: string, s: Situacao): string {
  const nome = `${nomeDaCasa(linha.casa)}, ${maiuscula(FORMATO_DIA.format(utc(dia)))}`;
  if (!linha.casa.aceita_reserva && dia >= hojeISO()) {
    return `${nome}: ${(ROTULO_DA_SITUACAO[linha.casa.status] ?? 'fora de uso').toLowerCase()}`;
  }
  if (s.cap === null) return `${nome}: sem ${nomeDaUnidade(unidade)} para reservar`;
  if (s.conflito) return `${nome}: ${s.tomado} reservados para ${capacidade(s.cap, unidade)} — conflito`;
  if (s.livre === 0) return `${nome}: lotada${s.pendente ? ', com pedido aguardando aprovação' : ''}`;
  return `${nome}: ${s.livre} de ${capacidade(s.cap, unidade)} ${s.livre === 1 ? 'livre' : 'livres'}`;
}

/** Número que vai embaixo de cada dia: o que sobra. Vazio quando não se aplica. */
function selo(linha: Linha, dia: string, s: Situacao): string {
  if (s.cap === null || (!linha.casa.aceita_reserva && dia >= hojeISO())) return '';
  const i = dados ? distancia(dados.de, dia) : -1;
  const sua = linha.minha[unidade][i] ? 'data-sua' : '';

  if (s.conflito) return html`<span class="cal-num" data-conflito ${raw(sua)}>!</span>`;
  if (s.livre === 0) {
    return html`<span class="cal-num" data-lotada="${lotadaPorAprovadas(s) ? 'ATIVA' : 'PENDENTE'}" ${raw(sua)}>0</span>`;
  }
  return html`<span class="cal-num" ${raw(s.livre < s.cap ? 'data-parcial' : '')} ${raw(sua)}>${String(s.livre)}</span>`;
}

/** Texto da barra conforme a largura: barras curtas mostram menos. */
function textoDaBarra(r: ReservaDoCalendario, dias: number, continuaAntes: boolean, continuaDepois: boolean): string {
  const u = unidadeDe(r);
  const titulo = r.projeto || r.finalidade || 'Reserva';
  const pendente = r.status === 'PENDENTE';
  const qtd = dias >= 3 ? `${r.quantidade} ${nomeDaUnidade(u, r.quantidade)}` : String(r.quantidade);
  const ate = dias >= 3 ? `até ${diaMes(r.fim)}${continuaDepois ? ' ›' : ''}` : '';

  return html`
    <span class="cal-barra-ev__titulo">${continuaAntes ? '‹ ' : ''}${titulo}</span>
    <span class="cal-barra-ev__det">· ${qtd}${pendente && dias >= 4 ? ' · aguardando' : ''}</span>
    ${raw(ate ? html`<span class="cal-barra-ev__ate">${ate}</span>` : '')}`;
}

function rotuloDaBarra(linha: Linha, r: ReservaDoCalendario): string {
  return `${codigoDaReserva(r.id)}, ${r.projeto ?? r.finalidade ?? 'reserva'}: `
    + `${capacidade(r.quantidade, unidadeDe(r))} na ${nomeDaCasa(linha.casa)}, `
    + `de ${dataBR(r.inicio)} a ${dataBR(r.fim)}, ${r.status === 'PENDENTE' ? 'aguardando aprovação' : 'aprovada'}`;
}

/* --- Linha do tempo -------------------------------------------------------- */

function pintarLinhaDoTempo(corpo: HTMLElement): void {
  const hoje = hojeISO();
  const { de, ate } = intervalo();
  const dias = diasDe(de, ate);
  const visiveis = linhasVisiveis();

  const cabecalho = html`
    <div class="tl__cab">
      <div class="tl__canto">
        <span>Estufa</span>
        <span class="tl__canto-sub">${diaDeReferencia() === hoje ? 'livres hoje' : `livres em ${diaMes(diaDeReferencia())}`}</span>
      </div>
      ${raw(juntar(dias.map((dia) => {
        const semana = diaDaSemana(dia);
        return html`
          <div class="tl__dia-cab" ${raw(dia === hoje ? 'data-hoje' : '')} ${raw(semana === 0 || semana === 6 ? 'data-fds' : '')}
               title="${maiuscula(FORMATO_DIA.format(utc(dia)))}">
            <span class="tl__sigla">${SIGLA_DIA[semana]}</span>
            <span class="tl__num">${Number(dia.slice(8))}</span>
          </div>`;
      })))}
    </div>`;

  const corpoDasLinhas = visiveis.length
    ? juntar(visiveis.map((linha, l) => faixaDaEstufa(linha, dias, l, hoje)))
    : html`<div class="cal-estado">Nenhuma estufa com esse filtro.</div>`;

  corpo.innerHTML = html`
    <div class="tl" data-modo="${modo}" style="--dias: ${String(dias.length)}">
      ${raw(cabecalho)}
      ${raw(corpoDasLinhas)}
    </div>`;

  // Voltou do mês de uma estufa: ela aparece no meio da grade, com o foco.
  if (rolarParaEstufa !== null) {
    const botao = qs<HTMLElement>(`.tl__estufa[data-casa="${rolarParaEstufa}"]`, corpo);
    rolarParaEstufa = null;
    botao?.scrollIntoView({ block: 'center' });
    botao?.focus({ preventScroll: true });
  }
}

/** Sai do mês de uma estufa e volta para todas, no modo em que estava. */
function voltarDoMes(): void {
  if (modo !== 'mes') return;
  rolarParaEstufa = estufaDoMes;
  modo = modoAntesDoMes;
  garantirCobertura();
}

function entrarNoMes(casaId: number | null): void {
  if (modo !== 'mes') modoAntesDoMes = modo;
  if (casaId !== null) estufaDoMes = casaId;
  modo = 'mes';
  garantirCobertura();
}

function faixaDaEstufa(linha: Linha, dias: string[], l: number, hoje: string): string {
  const de = dias[0];
  const ate = dias[dias.length - 1];
  const ref = diaDeReferencia();
  const s = noDia(linha, ref, unidade);
  const fora = !linha.casa.aceita_reserva;

  // Barras: as reservas da unidade escolhida que aparecem no intervalo.
  const doIntervalo = linha.casa.reservas.filter((r) => unidadeDe(r) === unidade && r.fim >= de && r.inicio <= ate);
  const comTrilha = emTrilhas(doIntervalo);
  let trilhas = comTrilha.reduce((n, x) => Math.max(n, x.trilha + 1), 0);

  // Fora de uso: uma faixa listrada de hoje (ou do começo da tela) em diante.
  const inicioFora = hoje > de ? hoje : de;
  const faixaFora = fora && inicioFora <= ate;
  const trilhaFora = faixaFora ? trilhas : -1;
  if (faixaFora) trilhas += 1;
  trilhas = Math.max(trilhas, 1);

  const coluna = (dia: string): number => distancia(de, dia) + 2;

  const barras = comTrilha.map(({ item: r, trilha }) => {
    const ini = r.inicio < de ? de : r.inicio;
    const fim = r.fim > ate ? ate : r.fim;
    const largura = distancia(ini, fim) + 1;
    return html`
      <button type="button" class="cal-barra-ev" data-status="${r.status}" ${raw(r.minha ? 'data-sua' : '')}
              data-action="cal-reserva" data-casa="${linha.casa.id}" data-reserva="${r.id}"
              style="grid-column: ${String(coluna(ini))} / ${String(coluna(fim) + 1)}; grid-row: ${String(trilha + 1)}"
              aria-label="${rotuloDaBarra(linha, r)}" title="${rotuloDaBarra(linha, r)}">
        ${raw(textoDaBarra(r, largura, r.inicio < de, r.fim > ate))}
      </button>`;
  });

  if (faixaFora) {
    const rotulo = ROTULO_DA_SITUACAO[linha.casa.status] ?? 'Fora de uso';
    barras.push(html`
      <div class="cal-barra-ev" data-status="fora"
           style="grid-column: ${String(coluna(inicioFora))} / ${String(dias.length + 2)}; grid-row: ${String(trilhaFora + 1)}">
        <span class="cal-barra-ev__titulo">${rotulo}</span>
        <span class="cal-barra-ev__det">· ${linha.casa.motivo || 'não aceita reservas'}</span>
      </div>`);
  }

  // Dias: o quadrinho inteiro é clicável (abre o dia) e leva o número embaixo.
  const celulas = dias.map((dia, c) => {
    const sd = noDia(linha, dia, unidade);
    const semana = diaDaSemana(dia);
    const rotulo = rotuloDoDia(linha, dia, sd);
    return html`
      <button type="button" class="tl__dia" data-action="cal-dia" data-casa="${linha.casa.id}" data-dia="${dia}"
              data-l="${String(l)}" data-c="${String(c)}" tabindex="${l === 0 && c === 0 ? '0' : '-1'}"
              ${raw(dia === hoje ? 'data-hoje' : '')} ${raw(semana === 0 || semana === 6 ? 'data-fds' : '')}
              ${raw(dia < hoje ? 'data-passado' : '')}
              style="grid-column: ${String(c + 2)}" aria-label="${rotulo}" title="${rotulo}">
        ${raw(selo(linha, dia, sd))}
      </button>`;
  });

  // Cabeça da faixa: nome, código e o que sobra no dia de referência.
  let resumo: string;
  let tom = 'livre';
  if (fora) {
    resumo = ROTULO_DA_SITUACAO[linha.casa.status] ?? 'Fora de uso';
    tom = 'fora';
  } else if (s.cap === null) {
    resumo = `Sem ${nomeDaUnidade(unidade)}`;
    tom = 'sem';
  } else if (s.livre === 0) {
    tom = lotadaPorAprovadas(s) ? 'ATIVA' : 'PENDENTE';
    resumo = `${tom === 'ATIVA' ? 'Lotada' : 'Reservada'} · 0 de ${s.cap}`;
  } else {
    resumo = `${s.livre} de ${capacidade(s.cap, unidade)} ${s.livre === 1 ? 'livre' : 'livres'}`;
  }
  const pct = s.cap ? Math.round((s.livre / s.cap) * 100) : 0;

  return html`
    <div class="tl__linha" ${raw(fora ? 'data-fora' : '')} style="--trilhas: ${String(trilhas)}">
      <button type="button" class="tl__estufa" data-action="cal-ver-mes" data-casa="${linha.casa.id}"
              title="Ver o mês da ${nomeDaCasa(linha.casa)}">
        <span class="tl__estufa-topo">
          <span class="tl__ponto" data-tom="${tom}" aria-hidden="true"></span>
          <span class="tl__nome">${nomeDaCasa(linha.casa)}</span>
          <span class="tl__codigo">${linha.casa.codigo}</span>
        </span>
        <span class="tl__resumo" data-tom="${tom}">${resumo}</span>
        ${raw(!fora && s.cap !== null
          ? html`<span class="tl__medidor" aria-hidden="true"><span style="width: ${String(pct)}%"></span></span>`
          : '')}
      </button>
      ${raw(juntar(celulas))}
      ${raw(juntar(barras))}
    </div>`;
}

/* --- Mês de uma estufa ------------------------------------------------------ */

function escolherEstufaPadrao(): void {
  if (estufaDoMes !== null && linhas.some((l) => l.casa.id === estufaDoMes)) return;
  // Sem escolha: a primeira que tem reserva no mês; senão, a primeira da lista.
  const { de, ate } = intervalo();
  const comReserva = linhas.find((l) => l.casa.reservas.some((r) => r.fim >= de && r.inicio <= ate));
  estufaDoMes = (comReserva ?? linhas[0])?.casa.id ?? null;
}

function pintarMes(corpo: HTMLElement): void {
  const linha = linhas.find((l) => l.casa.id === estufaDoMes);
  if (!linha) {
    corpo.innerHTML = html`<div class="cal-estado">Nenhuma estufa para mostrar.</div>`;
    setText('cal-estufa-nome', '—');
    return;
  }

  const cap = linha.casa.capacidades[unidade] ?? null;
  const btn = el('cal-estufa-nome');
  if (btn) {
    btn.innerHTML = html`<strong>${nomeDaCasa(linha.casa)}</strong>
      <span class="cal-barra__estufa-sub">${linha.casa.codigo} · ${cap === null ? `sem ${nomeDaUnidade(unidade)}` : capacidade(cap, unidade)}</span>`;
  }

  const hoje = hojeISO();
  const { de, ate } = intervalo();
  const mes = ancora.slice(0, 7);
  const fora = !linha.casa.aceita_reserva;
  const reservas = linha.casa.reservas.filter((r) => unidadeDe(r) === unidade);

  const semanas: string[] = [];
  for (let inicio = de, w = 0; inicio <= ate; inicio = somarDias(inicio, 7), w += 1) {
    const fim = somarDias(inicio, 6);
    const coluna = (dia: string): number => distancia(inicio, dia) + 1;

    const daSemana = reservas.filter((r) => r.fim >= inicio && r.inicio <= fim)
      .map((r) => ({ r, inicio: r.inicio < inicio ? inicio : r.inicio, fim: r.fim > fim ? fim : r.fim }));
    const comTrilha = emTrilhas(daSemana);
    let trilhas = comTrilha.reduce((n, x) => Math.max(n, x.trilha + 1), 0);

    const inicioFora = hoje > inicio ? hoje : inicio;
    const faixaFora = fora && inicioFora <= fim;
    const trilhaFora = trilhas;
    if (faixaFora) trilhas += 1;

    const barras = comTrilha.map(({ item, trilha }) => {
      const { r } = item;
      const largura = distancia(item.inicio, item.fim) + 1;
      return html`
        <button type="button" class="cal-barra-ev" data-status="${r.status}" ${raw(r.minha ? 'data-sua' : '')}
                data-action="cal-reserva" data-casa="${linha.casa.id}" data-reserva="${r.id}"
                style="grid-column: ${String(coluna(item.inicio))} / ${String(coluna(item.fim) + 1)}; grid-row: ${String(trilha + 2)}"
                aria-label="${rotuloDaBarra(linha, r)}" title="${rotuloDaBarra(linha, r)}">
          ${raw(textoDaBarra(r, largura * 2, r.inicio < item.inicio, r.fim > item.fim))}
        </button>`;
    });
    if (faixaFora) {
      barras.push(html`
        <div class="cal-barra-ev" data-status="fora"
             style="grid-column: ${String(coluna(inicioFora))} / 8; grid-row: ${String(trilhaFora + 2)}">
          <span class="cal-barra-ev__titulo">${ROTULO_DA_SITUACAO[linha.casa.status] ?? 'Fora de uso'}</span>
        </div>`);
    }

    const celulas = diasDe(inicio, fim).map((dia, c) => {
      const s = noDia(linha, dia, unidade);
      const doMes = dia.slice(0, 7) === mes;
      const rotulo = rotuloDoDia(linha, dia, s);
      let livre = '';
      if (doMes && s.cap !== null && !(fora && dia >= hoje)) {
        if (s.conflito) livre = html`<span class="cal-num" data-conflito>!</span>`;
        else if (s.livre === 0) livre = html`<span class="cal-num" data-lotada="${lotadaPorAprovadas(s) ? 'ATIVA' : 'PENDENTE'}">Lotada</span>`;
        else livre = html`<span class="cal-num" ${raw(s.livre < s.cap ? 'data-parcial' : '')}>${String(s.livre)} ${s.livre === 1 ? 'livre' : 'livres'}</span>`;
      }
      return html`
        <button type="button" class="mesg__dia" data-action="cal-dia" data-casa="${linha.casa.id}" data-dia="${dia}"
                data-l="${String(w)}" data-c="${String(c)}" tabindex="${w === 0 && c === 0 ? '0' : '-1'}"
                ${raw(dia === hoje ? 'data-hoje' : '')} ${raw(doMes ? '' : 'data-fora-mes')} ${raw(dia < hoje ? 'data-passado' : '')}
                style="grid-column: ${String(c + 1)}" aria-label="${rotulo}" title="${rotulo}">
          <span class="mesg__num">${dia.slice(0, 7) === mes ? String(Number(dia.slice(8))) : `${Number(dia.slice(8))}/${Number(dia.slice(5, 7))}`}</span>
          ${raw(livre)}
        </button>`;
    });

    semanas.push(html`
      <div class="mesg__semana" style="--trilhas: ${String(Math.max(trilhas, 2))}">
        ${raw(juntar(celulas))}
        ${raw(juntar(barras))}
      </div>`);
  }

  corpo.innerHTML = html`
    <div class="mesg">
      <div class="mesg__cab">
        ${raw(juntar(NOME_DO_DIA.map((nome) => html`<span>${nome}</span>`)))}
      </div>
      ${raw(juntar(semanas))}
    </div>`;
}

/* ===========================================================================
   Cartão da reserva (como o cartão de evento do Teams)
   =========================================================================== */

/** Primeiro dia, a partir de `desde`, em que sobra alguma coisa da unidade. */
function proximoDiaComVaga(linha: Linha, desde: string, u: UnidadeCapacidade): string | null {
  if (!dados) return null;
  for (let dia = desde; dia <= dados.ate; dia = somarDias(dia, 1)) {
    if (noDia(linha, dia, u).livre > 0) return dia;
  }
  return null;
}

function abrirCartao(casaId: number, reservaId: number, origem: HTMLElement): void {
  const linha = linhas.find((l) => l.casa.id === casaId);
  const r = linha?.casa.reservas.find((x) => x.id === reservaId);
  const cartao = el('cal-card');
  if (!linha || !r || !cartao) return;

  const u = unidadeDe(r);
  const cap = linha.casa.capacidades[u] ?? 0;
  const pendente = r.status === 'PENDENTE';
  const hoje = hojeISO();
  const dias = distancia(r.inicio, r.fim) + 1;

  // Lotada em algum dia desta reserva (dentro do que está carregado)?
  let lotadaAte: string | null = null;
  if (dados) {
    const de = r.inicio > dados.de ? r.inicio : dados.de;
    const ate = r.fim < dados.ate ? r.fim : dados.ate;
    for (const dia of diasDe(de, ate)) if (noDia(linha, dia, u).livre === 0) lotadaAte = dia;
  }
  const depois = somarDias(r.fim, 1);
  const contexto = lotadaAte
    ? html`A estufa fica <strong data-tom="lotada">lotada até ${diaMes(lotadaAte)}</strong>.
           Quando esta reserva acaba, ${capacidade(r.quantidade, u)}
           ${r.quantidade === 1 ? 'volta' : 'voltam'} em <strong data-tom="livre">${diaMes(depois)}</strong>.`
    : html`Sobra espaço na estufa durante esta reserva. Quando ela acaba,
           ${capacidade(r.quantidade, u)} ${r.quantidade === 1 ? 'volta' : 'voltam'} em <strong data-tom="livre">${diaMes(depois)}</strong>.`;

  // Reservar: no primeiro dia com vaga a partir de hoje (ou do fim, se lotada agora).
  const podeReservar = linha.casa.aceita_reserva && !motivoParaNaoReservar();
  const desde = r.inicio > hoje ? r.inicio : hoje;
  const diaLivre = podeReservar ? proximoDiaComVaga(linha, desde, u) ?? depois : null;
  const codigo = codigoDaReserva(r.id);
  const visivel = reservasDoEstado.some((x) => x.id === codigo);

  cartao.dataset.status = r.status;
  cartao.innerHTML = html`
    <div class="cal-card__faixa"></div>
    <div class="cal-card__corpo">
      <div class="cal-card__topo">
        <div class="cal-card__titulos">
          <div class="cal-card__selos">
            <span class="cal-card__codigo">${codigo}</span>
            <span class="pill ${pendente ? 'pill--booked' : 'pill--busy'}">${pendente ? 'Aguardando aprovação' : 'Aprovada'}</span>
            ${raw(r.minha ? '<span class="pill pill--ok">Sua</span>' : '')}
          </div>
          <h3 class="cal-card__titulo" id="cal-card-titulo">${r.projeto || r.finalidade || 'Reserva'}</h3>
          <p class="cal-card__sub">${nomeDaCasa(linha.casa)} · ${linha.casa.codigo}</p>
        </div>
        <button type="button" class="close-btn" data-action="cal-fechar-card" aria-label="Fechar">
          ${icone('x')}
        </button>
      </div>

      <ul class="cal-card__dados">
        <li>${icone('calendar-days', 'ic ic--sm')}<span><strong>${diaCurto(r.inicio)} → ${diaCurto(r.fim)}</strong> · ${plural(dias, 'dia', 'dias')}</span></li>
        <li>${icone('sprout', 'ic ic--sm')}<span><strong>${capacidade(r.quantidade, u)}</strong>${cap ? ` de ${cap} da estufa` : ''}</span></li>
        <li>${icone('user', 'ic ic--sm')}<span>Reservado por ${r.responsavel ?? 'responsável não informado'}</span></li>
        ${raw(r.finalidade && r.projeto ? html`<li>${icone('book-open', 'ic ic--sm')}<span>${r.finalidade}</span></li>` : '')}
      </ul>

      <p class="cal-card__contexto">${raw(contexto)}</p>

      <div class="cal-card__acoes">
        ${raw(visivel
          ? html`<button type="button" class="btn btn--quiet" data-action="cal-ver-reserva" data-reserva="${codigo}">Ver reserva</button>`
          : '')}
        ${raw(diaLivre
          ? html`<button type="button" class="btn btn--primary" data-action="cal-reservar-de" data-casa="${linha.casa.id}" data-dia="${diaLivre}">
                   ${icone('calendar-plus', 'ic ic--sm')}Reservar ${diaLivre <= hoje ? 'a partir de hoje' : `a partir de ${diaMes(diaLivre)}`}</button>`
          : '')}
      </div>
    </div>`;

  barraDoCartao = origem;
  cartaoAbertoEm = Date.now();
  show(cartao, true);
  posicionarCartao(cartao, origem);
  qs<HTMLButtonElement>('[data-action="cal-fechar-card"]', cartao)?.focus({ preventScroll: true });
}

/** Encosta o cartão na barra clicada, sem sair da janela. */
function posicionarCartao(cartao: HTMLElement, origem: HTMLElement): void {
  const alvo = origem.getBoundingClientRect();
  const largura = cartao.offsetWidth;
  const altura = cartao.offsetHeight;
  const margem = 12;

  let left = Math.max(margem, Math.min(alvo.left, window.innerWidth - largura - margem));
  let top = alvo.bottom + 8;
  if (top + altura > window.innerHeight - margem) top = alvo.top - altura - 8;
  if (top < margem) {
    top = margem;
    left = Math.min(alvo.right + 8, window.innerWidth - largura - margem);
  }

  cartao.style.left = `${Math.round(left)}px`;
  cartao.style.top = `${Math.round(top)}px`;
}

function fecharCartao(devolverFoco = true): void {
  const cartao = el('cal-card');
  if (!cartao || cartao.hidden) return;
  show(cartao, false);
  if (devolverFoco) barraDoCartao?.focus({ preventScroll: true });
  barraDoCartao = null;
}

/* ===========================================================================
   Detalhe do dia (modal)
   =========================================================================== */

function ocupados(n: number, u: UnidadeCapacidade): string {
  const base = u === 'BANCADA' ? 'ocupada' : 'ocupado';
  return n === 1 ? base : `${base}s`;
}

function medidor(linha: Linha, dia: string, u: UnidadeCapacidade): string {
  const s = noDia(linha, dia, u);
  if (s.cap === null) return '';

  const pct = s.cap ? Math.min(100, Math.round((s.tomado / s.cap) * 100)) : 0;
  const tom = s.conflito ? 'conflito' : s.livre === 0 ? 'cheia' : s.tomado === 0 ? 'livre' : 'parcial';

  return html`
    <div class="cal-medidor" data-tom="${tom}">
      <div class="cal-medidor__topo">
        <span class="cal-medidor__nome">${maiuscula(nomeDaUnidade(u))}</span>
        <span class="cal-medidor__livre">
          ${raw(s.conflito
            ? html`<strong>${s.tomado - s.cap}</strong> a mais do que cabe`
            : html`<strong>${s.livre}</strong> ${s.livre === 1 ? 'livre' : 'livres'}`)}
        </span>
      </div>
      <div class="cal-medidor__trilho" role="img" aria-label="${pct}% ocupado">
        <span style="width: ${pct}%"></span>
      </div>
      <p class="cal-medidor__texto">
        ${s.tomado} de ${capacidade(s.cap, u)} ${ocupados(s.tomado, u)}${s.pendente
          ? ` · ${s.pendente} aguardando aprovação` : ''}
      </p>
    </div>`;
}

/** "15 vasos voltam a ficar livres em 16/01/2027." — o que vem depois deste dia. */
function previsoes(linha: Linha, dia: string): string[] {
  const frases: string[] = [];

  for (const u of ['VASO', 'BANCADA'] as const) {
    if ((linha.casa.capacidades[u] ?? null) === null) continue;
    const daUnidade = linha.casa.reservas.filter((r) => unidadeDe(r) === u);

    const noDiaEscolhido = daUnidade.filter((r) => r.inicio <= dia && r.fim >= dia);
    if (noDiaEscolhido.length) {
      const primeiroFim = noDiaEscolhido.map((r) => r.fim).sort()[0];
      const voltam = noDiaEscolhido.filter((r) => r.fim === primeiroFim).reduce((n, r) => n + r.quantidade, 0);
      frases.push(
        `${capacidade(voltam, u)} ${voltam === 1 ? 'volta a ficar livre' : 'voltam a ficar livres'} em ${dataBR(somarDias(primeiroFim, 1))}.`,
      );
    }

    const proxima = daUnidade.filter((r) => r.inicio > dia).sort((a, b) => a.inicio.localeCompare(b.inicio))[0];
    if (proxima) {
      frases.push(
        `A partir de ${dataBR(proxima.inicio)}, mais ${capacidade(proxima.quantidade, u)} `
          + `${proxima.quantidade === 1 ? 'fica' : 'ficam'} ${ocupados(proxima.quantidade, u)}${proxima.projeto ? ` (${proxima.projeto})` : ''}.`,
      );
    }
  }

  return frases;
}

function itemDeReserva(r: ReservaDoCalendario): string {
  const u = unidadeDe(r);
  const pendente = r.status === 'PENDENTE';

  return html`
    <li class="cal-reserva">
      <span class="cal-reserva__qtd" data-unidade="${u}">${r.quantidade}</span>
      <span class="cal-reserva__texto">
        <span class="cal-reserva__titulo">
          ${r.projeto ?? r.finalidade ?? 'Reserva sem projeto'}
          ${raw(r.minha ? '<span class="cal-reserva__sua">sua</span>' : '')}
        </span>
        <span class="cal-reserva__meta">
          ${capacidade(r.quantidade, u)} · ${r.responsavel ?? 'responsável não informado'}
          · ${dataBR(r.inicio)} a ${dataBR(r.fim)}
        </span>
      </span>
      <span class="pill pill--${pendente ? 'booked' : 'busy'}">${pendente ? 'Aguardando' : 'Aprovada'}</span>
    </li>`;
}

export function abrirDia(casaId: number, dia: string): void {
  const linha = linhas.find((l) => l.casa.id === casaId);
  if (!linha || !dados) return;

  fecharCartao(false);
  diaAberto = { casa: casaId, dia };
  const hoje = hojeISO();

  setText('cal-dia-titulo', nomeDaCasa(linha.casa));
  setText('cal-dia-desc', `${maiuscula(FORMATO_DIA.format(utc(dia)))} · ${linha.casa.codigo}`);

  const medidores = el('cal-dia-medidores');
  if (medidores) medidores.innerHTML = juntar((['VASO', 'BANCADA'] as const).map((u) => medidor(linha, dia, u)));

  const noDiaEscolhido = linha.casa.reservas.filter((r) => r.inicio <= dia && r.fim >= dia);
  const lista = el('cal-dia-reservas');
  if (lista) {
    lista.innerHTML = noDiaEscolhido.length
      ? juntar(noDiaEscolhido.map(itemDeReserva))
      : html`<li class="cal-reserva cal-reserva--vazia">Nenhuma reserva neste dia.</li>`;
  }
  setText('cal-dia-conta', String(noDiaEscolhido.length));

  const frases = previsoes(linha, dia);
  const previsao = el('cal-dia-previsao');
  show(previsao, frases.length > 0);
  if (previsao) {
    previsao.innerHTML = juntar(frases.map((f) => html`<li>${icone('clock', 'ic ic--sm')}<span>${f}</span></li>`));
  }

  // O botão de reservar explica por que não dá, em vez de sumir.
  const temVaga = (['VASO', 'BANCADA'] as const).some((u) => {
    const s = noDia(linha, dia, u);
    return s.cap !== null && s.livre > 0;
  });
  const motivo = dia < hoje
    ? 'Este dia já passou.'
    : !linha.casa.aceita_reserva
      ? `Esta estufa está como ${(ROTULO_DA_SITUACAO[linha.casa.status] ?? 'fora de uso').toLowerCase()} e não aceita reservas.`
      : !temVaga
        ? 'A estufa está lotada neste dia.'
        : motivoParaNaoReservar();

  const botao = el<HTMLButtonElement>('cal-dia-reservar');
  if (botao) botao.disabled = Boolean(motivo);
  setText('cal-dia-motivo', motivo ?? '');
  show(el('cal-dia-motivo'), Boolean(motivo));

  abrirModal('modal-cal-dia');
}

/* ===========================================================================
   Reservar a partir do calendário
   =========================================================================== */

function reservar(casaId: number, inicio: string, fim: string): void {
  const impedimento = motivoParaNaoReservar();
  if (impedimento) {
    aviso(impedimento, 'error');
    return;
  }

  // O formulário de reserva conhece a estufa pela posição no mapa (E12).
  const chave = Object.keys(ID_REAL_ESPACO).find((k) => ID_REAL_ESPACO[k] === casaId);
  if (!chave) {
    aviso('Não achei esta estufa no cadastro; recarregue a página.', 'error');
    return;
  }

  fecharCartao(false);
  fecharModal(el('modal-cal-dia'));
  abrirModalReservar(chave, { inicio, fim, unidade });
}

/* ===========================================================================
   Navegação
   =========================================================================== */

function irPara(dia: string): void {
  ancora = dia;
  mesDoMini = inicioDoMes(dia);
  garantirCobertura();
}

function andar(passo: number): void {
  if (modo === 'mes') irPara(mesVizinho(ancora, passo));
  else irPara(somarDias(ancora, passo * (modo === 'semana' ? 7 : 14)));
}

/* ===========================================================================
   Ações e eventos
   =========================================================================== */

/** Ações declaradas no HTML (data-action), registradas pela casca. */
export const acoesDoCalendario: Record<string, (elemento: HTMLElement) => void> = {
  'cal-hoje': () => irPara(hojeISO()),
  'cal-andar': (elemento) => andar(Number(elemento.dataset.passo ?? 0)),
  'cal-ir': (elemento) => {
    if (elemento.dataset.dia) irPara(elemento.dataset.dia);
  },
  'cal-mini-mes': (elemento) => {
    mesDoMini = mesVizinho(mesDoMini, Number(elemento.dataset.passo ?? 0));
    pintarMini();
  },
  'cal-modo': (elemento) => {
    const novo = elemento.dataset.modo;
    if (novo === 'mes') {
      entrarNoMes(null);
      return;
    }
    modo = novo === 'semana' ? 'semana' : 'duas';
    garantirCobertura();
  },
  'cal-unidade': (elemento) => {
    unidade = elemento.dataset.unidade === 'BANCADA' ? 'BANCADA' : 'VASO';
    pintar();
  },
  'cal-filtro': (elemento) => {
    filtro = (elemento.dataset.filtro as Filtro) ?? 'todas';
    pintar();
  },
  'cal-ver-mes': (elemento) => entrarNoMes(Number(elemento.dataset.casa)),
  'cal-escolher-estufa': (elemento) => {
    const id = Number(elemento.dataset.casa);
    // Clicar de novo na estufa que já está aberta desmarca: volta para todas.
    if (id === estufaDoMes) {
      voltarDoMes();
      return;
    }
    estufaDoMes = id;
    pintar();
  },
  'cal-voltar': () => voltarDoMes(),
  'cal-dia': (elemento) => {
    abrirDia(Number(elemento.dataset.casa), elemento.dataset.dia ?? '');
  },
  'cal-reserva': (elemento) => {
    abrirCartao(Number(elemento.dataset.casa), Number(elemento.dataset.reserva), elemento);
  },
  'cal-fechar-card': () => fecharCartao(),
  'cal-ver-reserva': (elemento) => {
    const codigo = elemento.dataset.reserva;
    fecharCartao(false);
    if (codigo) verReserva(codigo);
  },
  'cal-reservar-de': (elemento) => {
    const dia = elemento.dataset.dia;
    if (dia) reservar(Number(elemento.dataset.casa), dia, dia);
  },
  'cal-reservar-dia': () => {
    if (diaAberto) reservar(diaAberto.casa, diaAberto.dia, diaAberto.dia);
  },
  'cal-recarregar': () => void carregar(),
};

/** As setas andam pelos dias; só um quadrinho fica na ordem do Tab. */
function andarPelaGrade(ev: KeyboardEvent): void {
  const atual = (ev.target as HTMLElement).closest<HTMLElement>('.tl__dia, .mesg__dia');
  if (!atual) return;

  const passos: Record<string, [number, number]> = {
    ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0],
  };
  const passo = passos[ev.key];
  if (!passo) return;

  const l = Number(atual.dataset.l) + passo[0];
  const c = Number(atual.dataset.c) + passo[1];
  const proximo = qs<HTMLElement>(`[data-action="cal-dia"][data-l="${l}"][data-c="${c}"]`, el('cal-corpo') ?? document);
  if (!proximo) return;

  ev.preventDefault();
  atual.tabIndex = -1;
  proximo.tabIndex = 0;
  proximo.focus();
}

function ligar(): void {
  if (ligado) return;
  ligado = true;

  el('cal-corpo')?.addEventListener('keydown', andarPelaGrade);

  const filtrar = debounce(() => pintar(), 200);
  el<HTMLInputElement>('busca-calendario')?.addEventListener('input', (ev) => {
    busca = (ev.target as HTMLInputElement).value;
    filtrar();
  });

  // O cartão fecha com Esc, clicando fora dele ou rolando a grade.
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape' || modalAberto()) return;
    if (!el('cal-card')?.hidden) {
      ev.stopPropagation();
      fecharCartao();
    } else if (modo === 'mes' && el('view-calendario')?.classList.contains('is-active')) {
      // Esc no mês de uma estufa também volta para todas.
      ev.stopPropagation();
      voltarDoMes();
    }
  }, true);
  document.addEventListener('click', (ev) => {
    const alvo = ev.target as Element | null;
    if (!alvo || alvo.closest('#cal-card') || alvo.closest('[data-action="cal-reserva"]')) return;
    fecharCartao(false);
  });
  el('cal-wrap')?.addEventListener('scroll', () => {
    if (Date.now() - cartaoAbertoEm > 400) fecharCartao(false);
  }, { passive: true });
  window.addEventListener('resize', () => fecharCartao(false));

  // Reserva criada, aprovada ou cancelada em outra tela: o calendário relê.
  aoMudar(() => {
    if (el('view-calendario')?.classList.contains('is-active') && el('cal-card')?.hidden !== false) void carregar();
  });
}
