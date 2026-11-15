/**
 * Histórico da estufa: todos os projetos que já passaram por ela.
 *
 * A ficha do mapa conta o hoje — quem está lá, quanto sobra, o que vem pela
 * frente. Mas a estufa tem história: quem plantou ali no ano passado, quantas
 * vezes um projeto voltou, quanto ele chegou a ocupar. Isso não cabia em lugar
 * nenhum, e era o que faltava para decidir ("esta estufa vive cheia" ou "só é
 * usada em março").
 *
 * Uma linha por projeto, do mais recente para o mais antigo: a API agrupa as
 * reservas e já devolve o pico, os dias ocupados e se a passagem é de agora,
 * do passado ou ainda por vir.
 */
import { ESTUFAS, ID_REAL_ESPACO } from '../data/estufas';
import { el, setText } from '../lib/dom';
import { dataBR } from '../lib/format';
import { html, icone, juntar, raw } from '../lib/html';
import { abrirModal } from '../lib/modal';
import { aviso } from '../lib/toast';
import { getHistoricoDaEstufa, type HistoricoDaEstufa, type PassagemPorEstufa } from '../services/api';

/** Como cada passagem se anuncia. */
const ESTADOS: Record<PassagemPorEstufa['estado'], { rotulo: string; pill: string }> = {
  agora: { rotulo: 'Está lá agora', pill: 'pill--ok' },
  futura: { rotulo: 'Ainda vai usar', pill: 'pill--booked' },
  passada: { rotulo: 'Já saiu', pill: 'pill--neutral' },
  cancelada: { rotulo: 'Desistiu', pill: 'pill--down' },
};

/** Qual estufa está aberta: a chave vem do botão ou do espaço na ficha. */
let lendo = 0;

export async function abrirHistoricoDaEstufa(chave: string | undefined): Promise<void> {
  const id = chave ?? espacoDaFicha();
  const estufa = id ? ESTUFAS[id] : undefined;
  const casaId = id ? ID_REAL_ESPACO[id] : undefined;

  if (!estufa || !casaId) {
    aviso('Não achei esta estufa no cadastro; recarregue a página.', 'error');
    return;
  }

  setText('hist-titulo', `Histórico da ${estufa.nome}`);
  setText('hist-desc', `${estufa.codigo} · tudo o que já foi plantado aqui`);
  pintarResumo(null);
  pintarConteudo(html`
    <div class="hist-vazio">
      ${icone('clock', 'ic ic--xl')}
      <p>Lendo o histórico&hellip;</p>
    </div>`);
  abrirModal('modal-historico');

  const meu = ++lendo;
  let dados: HistoricoDaEstufa;
  try {
    dados = await getHistoricoDaEstufa(casaId);
  } catch (erro) {
    if (meu !== lendo) return;
    pintarConteudo(html`
      <div class="hist-vazio">
        ${icone('circle-x', 'ic ic--xl')}
        <p>${erro instanceof Error ? erro.message : 'Não foi possível ler o histórico.'}</p>
      </div>`);
    return;
  }

  if (meu !== lendo) return; // já abriram outra estufa
  pintar(dados);
}

/** O espaço aberto na ficha do mapa, quando o botão não traz a chave. */
function espacoDaFicha(): string | undefined {
  return document.querySelector<HTMLElement>('.marker[aria-expanded="true"]')?.dataset.id;
}

function pintarResumo(dados: HistoricoDaEstufa | null): void {
  const alvo = el('hist-resumo');
  if (!alvo) return;

  if (!dados) {
    alvo.innerHTML = '';
    return;
  }

  const r = dados.resumo;
  const periodo = r.primeiro && r.ultimo
    ? `${dataBR(r.primeiro)} a ${dataBR(r.ultimo)}`
    : '—';

  // Reserva cancelada não conta como passagem, mas o número fica à vista:
  // sem ele, uma estufa com tudo cancelado mostraria "0 reservas" e nada mais.
  const reservas = r.canceladas
    ? `${r.reservas === 1 ? 'reserva' : 'reservas'} · ${r.canceladas} ${r.canceladas === 1 ? 'cancelada' : 'canceladas'}`
    : (r.reservas === 1 ? 'reserva' : 'reservas');

  const itens = [
    { rotulo: r.projetos === 1 ? 'projeto passou por aqui' : 'projetos passaram por aqui', valor: String(r.projetos) },
    { rotulo: reservas, valor: String(r.reservas) },
    { rotulo: r.reservas ? 'do começo ao fim' : 'nenhuma reserva chegou a valer', valor: periodo, largo: true },
  ];

  alvo.innerHTML = juntar(itens.map((i) => html`
    <div ${raw(i.largo ? 'class="hist-resumo__largo"' : '')}>
      <dt>${i.rotulo}</dt>
      <dd>${i.valor}</dd>
    </div>`));
}

function pintarConteudo(conteudo: string): void {
  const alvo = el('hist-conteudo');
  if (alvo) alvo.innerHTML = conteudo;
}

/** "9 vasos" ou "9 vasos e 2 bancadas": o pico, por unidade. */
function picoTexto(pico: PassagemPorEstufa['pico']): string {
  const partes: string[] = [];
  const vasos = pico.VASO ?? 0;
  const bancadas = pico.BANCADA ?? 0;
  if (vasos) partes.push(`${vasos} ${vasos === 1 ? 'vaso' : 'vasos'}`);
  if (bancadas) partes.push(`${bancadas} ${bancadas === 1 ? 'bancada' : 'bancadas'}`);
  return partes.join(' e ');
}

function periodoTexto(p: PassagemPorEstufa): string {
  if (!p.primeiro || !p.ultimo) return '—';
  if (p.primeiro === p.ultimo) return dataBR(p.primeiro);
  return `${dataBR(p.primeiro)} a ${dataBR(p.ultimo)}`;
}

function pintar(dados: HistoricoDaEstufa): void {
  pintarResumo(dados);

  if (!dados.projetos.length) {
    pintarConteudo(html`
      <div class="hist-vazio">
        ${icone('sprout', 'ic ic--xl')}
        <p>Nenhum projeto passou por esta estufa ainda. As reservas são feitas pelo mapa ou pelo calendário.</p>
      </div>`);
    return;
  }

  pintarConteudo(html`
    <ol class="hist-lista">
      ${raw(juntar(dados.projetos.map((p) => {
        const estado = ESTADOS[p.estado] ?? ESTADOS.passada;
        const pico = picoTexto(p.pico);

        const detalhes = [
          p.reservas ? `${p.reservas} ${p.reservas === 1 ? 'reserva' : 'reservas'}` : '',
          pico ? `até ${pico} de uma vez` : '',
          p.dias ? `${p.dias} ${p.dias === 1 ? 'dia' : 'dias'} de uso` : '',
          p.canceladas ? `${p.canceladas} ${p.canceladas === 1 ? 'cancelada' : 'canceladas'}` : '',
        ].filter(Boolean).join(' · ');

        return html`
          <li class="hist-item" data-estado="${p.estado}">
            <span class="hist-item__marca" aria-hidden="true"></span>
            <div class="hist-item__corpo">
              <div class="hist-item__topo">
                <h3 class="hist-item__titulo">${p.titulo}</h3>
                ${raw(p.codigo ? html`<span class="hist-item__codigo">${p.codigo}</span>` : '')}
                <span class="pill ${raw(estado.pill)}">${estado.rotulo}</span>
                ${raw(p.encerrado ? html`<span class="pill pill--neutral">Projeto encerrado</span>` : '')}
              </div>
              <p class="hist-item__periodo">${icone('calendar-days', 'ic ic--sm')}${periodoTexto(p)}</p>
              <p class="hist-item__detalhes">${detalhes}</p>
              ${raw(p.responsavel
                ? html`<p class="hist-item__quem">${icone('user', 'ic ic--sm')}${p.responsavel}${p.situacao ? ` · ${p.situacao}` : ''}</p>`
                : '')}
            </div>
          </li>`;
      })))}
    </ol>`);
}
