/**
 * Calendário geral de ocupação.
 *
 * Uma linha por estufa, uma coluna por dia do mês. Cada quadrinho diz quanto
 * da estufa está livre naquele dia: vazio (verde) é toda livre, com número é
 * parcial — o número é o que ainda sobra — e cheio é lotada. Clicar num dia
 * mostra quem está lá e quando a estufa volta a liberar espaço.
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
import { ID_REAL_ESPACO } from '../data/estufas';
import { motivoParaNaoReservar } from '../data/contexto';
import { aoMudar } from '../lib/bus';
import { debounce, el, qs, qsa, setText, show } from '../lib/dom';
import { capacidade, dataBR, hojeISO, plural } from '../lib/format';
import { html, icone, juntar, raw } from '../lib/html';
import { abrirModal, fecharModal } from '../lib/modal';
import { pintarStats } from '../lib/telas';
import { aviso } from '../lib/toast';
import { abrirModalReservar } from './reservas';

/* ===========================================================================
   Datas — sempre AAAA-MM-DD, contas em UTC para o fuso não mexer no dia
   =========================================================================== */

const DIA_MS = 86_400_000;
/** O back-end aceita até 100 dias por consulta. */
const MAXIMO_DE_DIAS = 100;

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

function inicioDoMes(mes: string): string {
  return `${mes}-01`;
}

function fimDoMes(mes: string): string {
  const [ano, m] = mes.split('-').map(Number);
  return paraISO(Date.UTC(ano, m, 0));
}

function mesVizinho(mes: string, passo: number): string {
  const [ano, m] = mes.split('-').map(Number);
  return paraISO(Date.UTC(ano, m - 1 + passo, 1)).slice(0, 7);
}

const FORMATO_MES = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const FORMATO_DIA = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
});
const LETRA_DO_DIA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

function maiuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/* ===========================================================================
   Estado
   =========================================================================== */

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

let mes = hojeISO().slice(0, 7);
let unidade: UnidadeCapacidade = 'VASO';
let filtro: Filtro = 'todas';
let busca = '';
let periodo: { de: string; ate: string } | null = null;

let dados: CalendarioOcupacao | null = null;
let linhas: Linha[] = [];
let falhou = false;
let pedido = 0;
let ligado = false;
/** Ao abrir o mês atual, a coluna de hoje é trazida para a vista uma vez. */
let rolarParaHoje = true;
/** Dia aberto no modal de detalhe. */
let diaAberto: { casa: number; dia: string } | null = null;

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
      const u: UnidadeCapacidade = r.unidade === 'BANCADA' ? 'BANCADA' : 'VASO';

      for (let i = de; i <= ate; i += 1) {
        linha.tomado[u][i] += r.quantidade;
        if (r.status === 'PENDENTE') linha.pendente[u][i] += r.quantidade;
        if (r.minha) linha.minha[u][i] = true;
      }
    }

    return linha;
  });
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

/** O menor livre no intervalo — é o que dá para reservar nele inteiro. */
function minimoLivre(linha: Linha, de: string, ate: string, u: UnidadeCapacidade): number | null {
  if ((linha.casa.capacidades[u] ?? null) === null) return null;

  let minimo = Infinity;
  for (let dia = de; dia <= ate; dia = somarDias(dia, 1)) {
    minimo = Math.min(minimo, noDia(linha, dia, u).livre);
  }
  return Number.isFinite(minimo) ? minimo : null;
}

/**
 * Sobre que dias os números de resumo falam: o período escolhido; sem
 * período, hoje (se o mês mostrado é o atual); senão, o mês inteiro.
 */
function referencia(): { de: string; ate: string; rotulo: string } {
  if (periodo) return { ...periodo, rotulo: 'no período' };

  const hoje = hojeISO();
  if (hoje.slice(0, 7) === mes) return { de: hoje, ate: hoje, rotulo: 'hoje' };

  return { de: inicioDoMes(mes), ate: fimDoMes(mes), rotulo: 'no mês' };
}

type Classe = 'vaga' | 'lotada' | 'fora' | 'sem';

function classificar(linha: Linha): { classe: Classe; livre: number | null } {
  const ref = referencia();
  const livre = minimoLivre(linha, ref.de, ref.ate, unidade);

  if (!linha.casa.aceita_reserva) return { classe: 'fora', livre };
  if (livre === null) return { classe: 'sem', livre };
  return { classe: livre > 0 ? 'vaga' : 'lotada', livre };
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
  // O período escolhido pode passar do mês mostrado: a consulta cobre os dois.
  let de = inicioDoMes(mes);
  let ate = fimDoMes(mes);
  if (periodo) {
    const deComPeriodo = periodo.de < de ? periodo.de : de;
    const ateComPeriodo = periodo.ate > ate ? periodo.ate : ate;

    // Navegou para longe do período marcado: ele sai, senão a consulta
    // passaria do limite do servidor.
    if (distancia(deComPeriodo, ateComPeriodo) + 1 > MAXIMO_DE_DIAS) {
      periodo = null;
      pintarControles();
    } else {
      de = deComPeriodo;
      ate = ateComPeriodo;
    }
  }

  const meu = ++pedido;
  el('cal-wrap')?.setAttribute('aria-busy', 'true');

  try {
    const resposta = await getCalendario(de, ate);
    if (meu !== pedido) return; // já pediram outro mês

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

/** Os dados carregados cobrem o mês e o período? Senão, busca de novo. */
function garantirCobertura(): void {
  const de = periodo && periodo.de < inicioDoMes(mes) ? periodo.de : inicioDoMes(mes);
  const ate = periodo && periodo.ate > fimDoMes(mes) ? periodo.ate : fimDoMes(mes);

  if (dados && dados.de <= de && dados.ate >= ate) pintar();
  else void carregar();
}

/* ===========================================================================
   Pintura
   =========================================================================== */

function pintar(): void {
  pintarControles();

  const grade = el('cal-grade');
  if (!grade) return;

  if (!dados) {
    grade.innerHTML = html`
      <tbody><tr><td class="cal__estado">
        ${raw(falhou
          ? html`Não consegui carregar o calendário.
              <button type="button" class="btn btn--quiet btn--sm" data-action="cal-recarregar">Tentar de novo</button>`
          : 'Carregando o calendário…')}
      </td></tr></tbody>`;
    return;
  }

  pintarResumo();
  pintarGrade(grade);
}

function pintarControles(): void {
  setText('cal-mes', maiuscula(FORMATO_MES.format(utc(inicioDoMes(mes)))));

  for (const botao of qsa<HTMLButtonElement>('[data-action="cal-unidade"]')) {
    botao.setAttribute('aria-checked', String(botao.dataset.unidade === unidade));
  }
  for (const botao of qsa<HTMLButtonElement>('[data-action="cal-filtro"]')) {
    botao.setAttribute('aria-checked', String(botao.dataset.filtro === filtro));
  }

  const de = el<HTMLInputElement>('cal-de');
  const ate = el<HTMLInputElement>('cal-ate');
  if (de && document.activeElement !== de) de.value = periodo?.de ?? '';
  if (ate && document.activeElement !== ate) {
    ate.value = periodo?.ate ?? '';
    ate.min = periodo?.de ?? '';
  }
  show(el('cal-limpar-periodo'), Boolean(periodo));
}

function pintarResumo(): void {
  const ref = referencia();
  const contagem = { vaga: 0, lotada: 0, fora: 0, sem: 0 };
  for (const linha of linhas) contagem[classificar(linha).classe] += 1;

  // Ocupação do mês mostrado, na unidade escolhida.
  let cabe = 0;
  let usado = 0;
  let conflitos = 0;
  const inicio = inicioDoMes(mes);
  const fim = fimDoMes(mes);
  for (const linha of linhas) {
    for (let dia = inicio; dia <= fim; dia = somarDias(dia, 1)) {
      const s = noDia(linha, dia, unidade);
      if (s.cap === null) continue;
      cabe += s.cap;
      usado += Math.min(s.tomado, s.cap);
      if (s.conflito) conflitos += 1;
    }
  }

  pintarStats('stats-calendario', [
    { icone: 'circle-check', numero: contagem.vaga, rotulo: `Com vaga ${ref.rotulo}`, tom: 'ok' },
    { icone: 'ban', numero: contagem.lotada, rotulo: `Lotadas ${ref.rotulo}`, tom: 'busy' },
    { icone: 'wrench', numero: contagem.fora, rotulo: 'Fora de uso', tom: 'down' },
    { icone: 'chart-pie', numero: porcentagem(usado, cabe), rotulo: 'Ocupação no mês', tom: 'booked' },
  ]);

  const alerta = el('cal-conflitos');
  show(alerta, conflitos > 0);
  if (conflitos > 0) {
    setText(
      'cal-conflitos-texto',
      `${plural(conflitos, 'dia com mais reserva do que cabe', 'dias com mais reserva do que cabe')} neste mês. `
        + 'Eles aparecem marcados com “!” — clique para ver quais reservas se cruzam.',
    );
  }
}

/** Concorda com a unidade: "vasos ocupados", "bancadas ocupadas". */
function ocupados(n: number, u: UnidadeCapacidade): string {
  const base = u === 'BANCADA' ? 'ocupada' : 'ocupado';
  return n === 1 ? base : `${base}s`;
}

/** "37%"; pouco uso não vira "0%", que leria como nenhum. */
function porcentagem(parte: number, total: number): string {
  if (!total || !parte) return '0%';
  const pct = (parte / total) * 100;
  return pct < 1 ? '<1%' : `${Math.round(pct)}%`;
}

function rotuloDaCelula(linha: Linha, s: Situacao): string {
  if (s.cap === null) return `sem ${nomeDaUnidade(unidade)} para reservar`;
  if (s.conflito) return `${s.tomado} reservados para ${capacidade(s.cap, unidade)} — conflito`;
  if (s.tomado === 0) {
    return linha.casa.aceita_reserva
      ? `toda livre (${capacidade(s.cap, unidade)})`
      : (ROTULO_DA_SITUACAO[linha.casa.status] ?? 'fora de uso').toLowerCase();
  }
  if (s.livre === 0) return `lotada (${capacidade(s.cap, unidade)})`;
  return `${s.livre} de ${capacidade(s.cap, unidade)} ${s.livre === 1 ? 'livre' : 'livres'}`;
}

function celula(linha: Linha, dia: string, l: number, c: number, hoje: string): string {
  const s = noDia(linha, dia, unidade);
  const i = dados ? distancia(dados.de, dia) : -1;

  let estado = 'livre';
  let texto = '';
  let nivel = 0;

  if (s.cap === null) {
    estado = 'sem';
  } else if (s.conflito) {
    estado = 'conflito';
    texto = '!';
  } else if (s.tomado === 0) {
    // Estufa fora de uso: hoje e adiante ela não é "livre". O passado fica
    // como foi, para o histórico não mentir.
    estado = !linha.casa.aceita_reserva && dia >= hoje ? 'fora' : 'livre';
  } else if (s.livre === 0) {
    estado = 'cheia';
  } else {
    estado = 'parcial';
    texto = s.livre > 99 ? '99+' : String(s.livre);
    const fracao = s.tomado / (s.cap || 1);
    nivel = fracao <= 1 / 3 ? 1 : fracao <= 2 / 3 ? 2 : 3;
  }

  const rotulo = `${linha.casa.descricao ?? linha.casa.codigo}, ${dataBR(dia)}: ${rotuloDaCelula(linha, s)}`;
  const naFaixa = periodo && dia >= periodo.de && dia <= periodo.ate;

  return html`
    <td ${raw(dia === hoje ? 'data-hoje' : '')} ${raw(naFaixa ? 'data-periodo' : '')}
        ${raw(new Date(utc(dia)).getUTCDay() === 1 ? 'data-seg' : '')}>
      <button type="button" class="cal__cel" data-estado="${estado}" data-nivel="${nivel || ''}"
              ${raw(linha.minha[unidade][i] ? 'data-minha' : '')} ${raw(dia < hoje ? 'data-passado' : '')}
              data-action="cal-dia" data-casa="${linha.casa.id}" data-dia="${dia}"
              data-l="${l}" data-c="${c}" tabindex="${l === 0 && c === 0 ? '0' : '-1'}"
              aria-label="${rotulo}" title="${rotulo}">${texto}</button>
    </td>`;
}

function celulaDeResumo(linha: Linha, hoje: string): string {
  const { classe, livre } = classificar(linha);
  const cap = linha.casa.capacidades[unidade] ?? 0;

  if (classe === 'fora') {
    return html`<td class="cal__resumo"><span class="pill pill--neutral">${ROTULO_DA_SITUACAO[linha.casa.status] ?? 'Fora de uso'}</span></td>`;
  }
  if (classe === 'sem' || livre === null) {
    return html`<td class="cal__resumo cal__resumo--vazio">&mdash;</td>`;
  }

  // Com um período escolhido que ainda não passou, dá para reservar dali mesmo.
  const podeReservar = periodo && livre > 0 && periodo.de >= hoje;

  return html`
    <td class="cal__resumo" data-classe="${classe}">
      <span class="cal__livre"><strong>${livre}</strong> de ${cap}</span>
      ${raw(podeReservar
        ? html`<button type="button" class="cal__reservar" data-action="cal-reservar"
                       data-casa="${linha.casa.id}">Reservar</button>`
        : '')}
    </td>`;
}

function pintarGrade(grade: HTMLElement): void {
  if (!dados) return;

  const hoje = hojeISO();
  const ref = referencia();
  const dias: string[] = [];
  for (let dia = inicioDoMes(mes); dia <= fimDoMes(mes); dia = somarDias(dia, 1)) dias.push(dia);

  const alvo = busca.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const visiveis = linhas.filter((linha) => {
    const { classe } = classificar(linha);
    if (filtro === 'vaga' && classe !== 'vaga') return false;
    if (filtro === 'lotadas' && classe !== 'lotada') return false;
    if (filtro === 'fora' && classe !== 'fora') return false;
    if (!alvo) return true;

    const texto = `${linha.casa.codigo} ${linha.casa.descricao ?? ''} ${linha.casa.localizacao ?? ''}`
      .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    return texto.includes(alvo);
  });

  setText('conta-calendario', String(visiveis.length));

  const cabecalho = html`
    <colgroup>
      <col class="cal__col-estufa" />
      ${raw(juntar(dias.map(() => '<col />')))}
      <col class="cal__col-resumo" />
    </colgroup>
    <thead>
      <tr>
        <th scope="col" class="cal__canto">Estufa</th>
        ${raw(juntar(dias.map((dia) => {
          const semana = new Date(utc(dia)).getUTCDay();
          const naFaixa = periodo && dia >= periodo.de && dia <= periodo.ate;
          return html`
            <th scope="col" class="cal__dia" ${raw(dia === hoje ? 'data-hoje' : '')}
                ${raw(semana === 0 || semana === 6 ? 'data-fds' : '')}
                ${raw(naFaixa ? 'data-periodo' : '')} ${raw(semana === 1 ? 'data-seg' : '')}>
              <button type="button" data-action="cal-periodo-dia" data-dia="${dia}"
                      title="${maiuscula(FORMATO_DIA.format(utc(dia)))} — clique para marcar o período"
                      aria-label="${maiuscula(FORMATO_DIA.format(utc(dia)))}">
                <span class="cal__sem" aria-hidden="true">${LETRA_DO_DIA[semana]}</span>
                <span class="cal__num">${Number(dia.slice(8))}</span>
              </button>
            </th>`;
        })))}
        <th scope="col" class="cal__canto cal__canto--fim">Livre ${ref.rotulo}</th>
      </tr>
    </thead>`;

  const corpo = visiveis.length
    ? juntar(visiveis.map((linha, l) => {
      const cap = linha.casa.capacidades[unidade] ?? null;
      return html`
        <tr ${raw(linha.casa.aceita_reserva ? '' : 'data-fora')}>
          <th scope="row" class="cal__estufa">
            <span class="cal__nome">${linha.casa.descricao ?? linha.casa.codigo}</span>
            <span class="cal__sub">${linha.casa.codigo} · ${cap === null ? `sem ${nomeDaUnidade(unidade)}` : capacidade(cap, unidade)}</span>
          </th>
          ${raw(juntar(dias.map((dia, c) => celula(linha, dia, l, c, hoje))))}
          ${raw(celulaDeResumo(linha, hoje))}
        </tr>`;
    }))
    : html`<tr><td class="cal__estado" colspan="${dias.length + 2}">Nenhuma estufa com esse filtro.</td></tr>`;

  grade.innerHTML = `${cabecalho}<tbody>${corpo}</tbody>`;

  if (rolarParaHoje && hoje.slice(0, 7) === mes) {
    rolarParaHoje = false;
    qs('th[data-hoje]', grade)?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }
}

/* ===========================================================================
   Detalhe do dia
   =========================================================================== */

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
    const daUnidade = linha.casa.reservas.filter((r) => (r.unidade === 'BANCADA' ? 'BANCADA' : 'VASO') === u);

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
  const u: UnidadeCapacidade = r.unidade === 'BANCADA' ? 'BANCADA' : 'VASO';
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
      <span class="pill pill--${pendente ? 'busy' : 'ok'}">${pendente ? 'Pendente' : 'Ativa'}</span>
    </li>`;
}

export function abrirDia(casaId: number, dia: string): void {
  const linha = linhas.find((l) => l.casa.id === casaId);
  if (!linha || !dados) return;

  diaAberto = { casa: casaId, dia };
  const hoje = hojeISO();

  setText('cal-dia-titulo', linha.casa.descricao ?? linha.casa.codigo);
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

  fecharModal(el('modal-cal-dia'));
  abrirModalReservar(chave, { inicio, fim, unidade });
}

/* ===========================================================================
   Período
   =========================================================================== */

function definirPeriodo(novo: { de: string; ate: string } | null): void {
  if (novo && distancia(novo.de, novo.ate) + 1 > MAXIMO_DE_DIAS - 31) {
    aviso('Escolha um período de até 2 meses para ver no calendário.', 'error');
    return;
  }

  periodo = novo;
  garantirCobertura();
}

/**
 * Clique no cabeçalho de um dia: o primeiro marca o início, o segundo fecha o
 * período, e um terceiro começa outro.
 */
function marcarDia(dia: string): void {
  if (!periodo || periodo.de !== periodo.ate) {
    definirPeriodo({ de: dia, ate: dia });
    return;
  }
  definirPeriodo(dia < periodo.de ? { de: dia, ate: periodo.de } : { de: periodo.de, ate: dia });
}

function lerPeriodoDosCampos(): void {
  const de = el<HTMLInputElement>('cal-de')?.value ?? '';
  let ate = el<HTMLInputElement>('cal-ate')?.value ?? '';

  if (!de) {
    if (periodo) definirPeriodo(null);
    return;
  }
  if (!ate || ate < de) ate = de;

  // O período escolhido puxa o calendário para o mês em que ele começa.
  if (de.slice(0, 7) !== mes) mes = de.slice(0, 7);
  definirPeriodo({ de, ate });
}

/* ===========================================================================
   Ações e eventos
   =========================================================================== */

/** Ações declaradas no HTML (data-action), registradas pela casca. */
export const acoesDoCalendario: Record<string, (elemento: HTMLElement) => void> = {
  'cal-mes': (elemento) => {
    const passo = Number(elemento.dataset.passo ?? 0);
    if (passo === 0) {
      mes = hojeISO().slice(0, 7);
      rolarParaHoje = true;
    } else {
      mes = mesVizinho(mes, passo);
    }
    pintarControles();
    void carregar();
  },
  'cal-unidade': (elemento) => {
    unidade = elemento.dataset.unidade === 'BANCADA' ? 'BANCADA' : 'VASO';
    pintar();
  },
  'cal-filtro': (elemento) => {
    filtro = (elemento.dataset.filtro as Filtro) ?? 'todas';
    pintar();
  },
  'cal-dia': (elemento) => {
    abrirDia(Number(elemento.dataset.casa), elemento.dataset.dia ?? '');
  },
  'cal-periodo-dia': (elemento) => {
    if (elemento.dataset.dia) marcarDia(elemento.dataset.dia);
  },
  'cal-limpar-periodo': () => definirPeriodo(null),
  'cal-reservar': (elemento) => {
    if (periodo) reservar(Number(elemento.dataset.casa), periodo.de, periodo.ate);
  },
  'cal-reservar-dia': () => {
    if (!diaAberto) return;
    // Com um período marcado que contém o dia, a reserva já vem com ele.
    const dentro = periodo && diaAberto.dia >= periodo.de && diaAberto.dia <= periodo.ate;
    reservar(diaAberto.casa, dentro && periodo ? periodo.de : diaAberto.dia, dentro && periodo ? periodo.ate : diaAberto.dia);
  },
  'cal-recarregar': () => void carregar(),
};

/** As setas andam pelos dias; só um quadrinho fica na ordem do Tab. */
function andarPelaGrade(ev: KeyboardEvent): void {
  const atual = (ev.target as HTMLElement).closest<HTMLElement>('.cal__cel');
  if (!atual) return;

  const passos: Record<string, [number, number]> = {
    ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0],
  };
  const passo = passos[ev.key];
  if (!passo) return;

  const l = Number(atual.dataset.l) + passo[0];
  const c = Number(atual.dataset.c) + passo[1];
  const proximo = qs<HTMLElement>(`.cal__cel[data-l="${l}"][data-c="${c}"]`, el('cal-grade') ?? document);
  if (!proximo) return;

  ev.preventDefault();
  atual.tabIndex = -1;
  proximo.tabIndex = 0;
  proximo.focus();
}

function ligar(): void {
  if (ligado) return;
  ligado = true;

  el('cal-grade')?.addEventListener('keydown', andarPelaGrade);

  const filtrar = debounce(() => pintar(), 200);
  el<HTMLInputElement>('busca-calendario')?.addEventListener('input', (ev) => {
    busca = (ev.target as HTMLInputElement).value;
    filtrar();
  });

  el<HTMLInputElement>('cal-de')?.addEventListener('change', lerPeriodoDosCampos);
  el<HTMLInputElement>('cal-ate')?.addEventListener('change', lerPeriodoDosCampos);

  // Reserva criada, aprovada ou cancelada em outra tela: o calendário relê.
  aoMudar(() => {
    if (el('view-calendario')?.classList.contains('is-active')) void carregar();
  });
}
