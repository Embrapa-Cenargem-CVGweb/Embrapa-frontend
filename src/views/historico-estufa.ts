/**
 * Histórico da estufa: os projetos que já passaram por ela.
 *
 * A ficha do mapa conta o hoje — quem está lá, quanto sobra, o que vem pela
 * frente. Mas a estufa tem história: quem plantou ali no ano passado, quem
 * usou em março. Isso não cabia em lugar nenhum, e era o que faltava para
 * decidir ("esta estufa vive cheia" ou "só é usada em março").
 *
 * Uma linha por projeto, do mais recente para o mais antigo: o projeto e o
 * período em que ele esteve aqui. Nada de contagem de reservas nem de pedido
 * desfeito — isso é trilha, e a trilha tem a própria tela.
 */
import { ESTUFAS, ID_REAL_ESPACO } from '../data/estufas';
import { el, setText } from '../lib/dom';
import { dataBR } from '../lib/format';
import { html, icone, juntar, raw } from '../lib/html';
import { abrirModal } from '../lib/modal';
import { aviso } from '../lib/toast';
import { getHistoricoDaEstufa, type HistoricoDaEstufa, type PassagemPorEstufa } from '../services/api';

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
  setText('hist-desc', `${estufa.codigo} · os projetos que já passaram por aqui`);
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

  const itens = [
    {
      rotulo: r.projetos === 1 ? 'projeto passou por aqui' : 'projetos passaram por aqui',
      valor: String(r.projetos),
    },
    {
      rotulo: r.projetos ? 'do primeiro ao último dia de uso' : 'nenhum projeto usou esta estufa',
      valor: periodo,
      largo: true,
    },
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

/** "de 01/03/2025 a 10/03/2025", ou um dia só quando entrou e saiu no mesmo. */
function periodoTexto(p: PassagemPorEstufa): string {
  if (!p.entrou || !p.saiu) return '—';
  if (p.entrou === p.saiu) return `em ${dataBR(p.entrou)}`;
  return `de ${dataBR(p.entrou)} a ${dataBR(p.saiu)}`;
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
      ${raw(juntar(dados.projetos.map((p) => html`
        <li class="hist-item" ${raw(p.atual ? 'data-atual="1"' : '')}>
          <span class="hist-item__marca" aria-hidden="true"></span>
          <div class="hist-item__corpo">
            <div class="hist-item__topo">
              <h3 class="hist-item__titulo">${p.titulo}</h3>
              ${raw(p.codigo ? html`<span class="hist-item__codigo">${p.codigo}</span>` : '')}
              ${raw(p.atual ? html`<span class="pill pill--ok">Está aqui agora</span>` : '')}
            </div>
            <p class="hist-item__periodo">${icone('calendar-days', 'ic ic--sm')}${periodoTexto(p)}</p>
            ${raw(p.responsavel
              ? html`<p class="hist-item__quem">${icone('user', 'ic ic--sm')}${p.responsavel}</p>`
              : '')}
          </div>
        </li>`)))}
    </ol>`);
}
