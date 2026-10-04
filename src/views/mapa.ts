/**
 * Mapa do campus.
 *
 * Cada espaço é um <button> posicionado em porcentagem sobre a foto aérea, com
 * nome acessível completo ("Estufa 03, ocupada"), alcançável por teclado. Clicar
 * ou acionar abre a ficha lateral.
 */
import { ESTUFAS, reservaDoEspaco } from '../data/estufas';
import { HOTSPOTS } from '../data/hotspots';
import { el, qs, qsa, setText, show } from '../lib/dom';
import { html, icone } from '../lib/html';
import { dataBR, plural, statusInfo, statusPill } from '../lib/format';
import { modalAberto } from '../lib/modal';
import { aviso } from '../lib/toast';
import type { Estufa } from '../types';

let espacoAtivo: string | null = null;
let fechandoPainel: number | undefined;

/* ===========================================================================
   Valores derivados
   =========================================================================== */

/**
 * Condições ambientais plausíveis e estáveis por espaço. São só ilustrativas,
 * enquanto a telemetria não existir: derivadas do código, nunca sorteadas, para
 * não mudarem a cada render.
 */
function condicoes(id: string): { temp: number; umidade: number } {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return { temp: 24 + (hash % 7), umidade: 55 + ((hash >> 3) % 20) };
}

function setor(estufa: Estufa): string {
  if (estufa.setor) return estufa.setor;
  const letra = estufa.nome.match(/([A-Z])\s*\d+\s*$/)?.[1];
  return letra ? `Setor ${letra}` : estufa.tipo;
}

function disponibilidade(status: Estufa['status']): string {
  switch (status) {
    case 'livre': return 'Disponível agora';
    case 'manutencao': return 'Em manutenção';
    case 'ocupada': return 'Em uso';
    default: return 'Sob reserva';
  }
}

function nomeAcessivel(id: string): string {
  const estufa = ESTUFAS[id];
  if (!estufa) return `${id}, sem dados`;
  return `${estufa.nome}, ${statusInfo(estufa.status).label.toLowerCase()}`;
}

/* ===========================================================================
   Marcadores
   =========================================================================== */

export function renderizarMarcadores(): void {
  const camada = el('map-marcadores');
  if (!camada) return;

  const fragmento = document.createDocumentFragment();

  for (const { id, left, top } of HOTSPOTS) {
    const estufa = ESTUFAS[id];

    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'marker';
    botao.dataset.action = 'abrir-espaco';
    botao.dataset.id = id;
    botao.dataset.status = estufa ? estufa.status : 'indefinido';
    botao.style.left = `${left}%`;
    botao.style.top = `${top}%`;
    botao.setAttribute('aria-controls', 'painel');
    botao.setAttribute('aria-expanded', 'false');
    botao.setAttribute('aria-label', nomeAcessivel(id));

    const nome = document.createElement('span');
    nome.className = 'marker__name';
    nome.setAttribute('aria-hidden', 'true');
    nome.textContent = estufa ? estufa.nome : id;

    const ponto = document.createElement('span');
    ponto.className = 'marker__dot';

    botao.append(nome, ponto);
    fragmento.append(botao);
  }

  camada.replaceChildren(fragmento);
}

/** Atualiza status e rótulo dos marcadores sem recriá-los (preserva o foco). */
export function sincronizarMarcadores(): void {
  for (const botao of qsa<HTMLButtonElement>('.marker')) {
    const id = botao.dataset.id;
    if (!id) continue;
    const estufa = ESTUFAS[id];
    botao.dataset.status = estufa ? estufa.status : 'indefinido';
    botao.setAttribute('aria-label', nomeAcessivel(id));
    const nome = qs('.marker__name', botao);
    if (nome && estufa) nome.textContent = estufa.nome;
  }

  // A ficha aberta reflete a mudança na hora.
  if (espacoAtivo && ESTUFAS[espacoAtivo]) preencherPainel(espacoAtivo);
}

function marcarSelecionado(id: string | null): void {
  for (const botao of qsa<HTMLButtonElement>('.marker')) {
    botao.setAttribute('aria-expanded', String(botao.dataset.id === id));
  }
}

/* ===========================================================================
   Ficha do espaço
   =========================================================================== */

function preencherPainel(id: string): void {
  const estufa = ESTUFAS[id];
  const painel = el('painel');
  if (!estufa || !painel) return;

  painel.dataset.status = estufa.status;

  setText('painel-codigo', id);
  setText('painel-nome', estufa.nome);
  setText('painel-tipo', estufa.tipo);

  const status = el('painel-status');
  if (status) status.innerHTML = html`${statusPill(estufa.status)}`;

  setText('painel-descricao', estufa.desc || 'Sem descrição cadastrada.');
  setText('painel-setor', setor(estufa));
  setText('painel-area', estufa.area);
  setText('painel-bancadas', plural(estufa.cap, 'bancada', 'bancadas'));

  const { temp, umidade } = condicoes(id);
  setText('painel-condicoes', `${temp} °C, ${umidade}% de umidade`);
  setText('painel-disponibilidade', disponibilidade(estufa.status));

  // Capacidade de vasos
  const vasos = el('painel-vasos');
  show(vasos, Boolean(estufa.vasos));
  if (estufa.vasos) {
    setText('painel-vaso-3', String(estufa.vasos.c3));
    setText('painel-vaso-5', String(estufa.vasos.c5));
    setText('painel-vaso-10', String(estufa.vasos.c10));
  }

  // Reserva vinculada
  const reserva = reservaDoEspaco(id);
  const bloco = el('painel-reserva');
  show(bloco, Boolean(reserva));
  if (reserva) {
    setText('painel-reserva-projeto', reserva.projeto);
    setText(
      'painel-reserva-meta',
      `${statusInfo(reserva.status).label}, para ${dataBR(reserva.data)}, com `
      + `${plural(reserva.qtd, 'vaso ou estante', 'vasos ou estantes')}.`,
    );
  }

  configurarAcao(estufa, id, reserva?.id);
}

function configurarAcao(estufa: Estufa, id: string, reservaId?: string): void {
  const botao = el<HTMLButtonElement>('painel-acao');
  if (!botao) return;

  botao.disabled = false;
  botao.className = 'btn btn--primary btn--block';
  delete botao.dataset.id;

  if (estufa.status === 'livre') {
    botao.dataset.action = 'abrir-reservar';
    botao.dataset.id = id;
    botao.innerHTML = html`${icone('calendar-plus', 'ic ic--sm')}Reservar este espaço`;
    return;
  }

  if (reservaId) {
    botao.dataset.action = 'ver-reserva';
    botao.dataset.id = reservaId;
    botao.className = 'btn btn--quiet btn--block';
    botao.innerHTML = html`${icone('eye', 'ic ic--sm')}Ver a reserva`;
    return;
  }

  const status = statusInfo(estufa.status);
  botao.dataset.action = 'sem-acao';
  botao.className = 'btn btn--quiet btn--block';
  botao.disabled = true;
  botao.innerHTML = html`${icone(status.icon, 'ic ic--sm')}${status.label}`;
}

export function abrirPainel(id: string): void {
  if (!ESTUFAS[id]) {
    aviso('Os dados deste espaço ainda não foram carregados.', 'error');
    return;
  }

  const painel = el('painel');
  if (!painel) return;

  window.clearTimeout(fechandoPainel);
  espacoAtivo = id;
  preencherPainel(id);
  marcarSelecionado(id);

  const jaAberto = painel.classList.contains('is-open');
  show(painel, true);
  if (!jaAberto) {
    // Um frame com a ficha visível mas fora da tela, para a transição rodar.
    requestAnimationFrame(() => painel.classList.add('is-open'));
    // preventScroll é essencial: a ficha começa deslocada para fora do mapa,
    // e sem isso o navegador rola o contêiner para trazê-la à vista — é o
    // que dava a impressão de que o mapa era empurrado para o lado.
    painel.focus({ preventScroll: true });
  }
}

export function fecharPainel(): void {
  const painel = el('painel');
  if (!painel || !painel.classList.contains('is-open')) return;

  const anterior = espacoAtivo;
  painel.classList.remove('is-open');
  marcarSelecionado(null);
  espacoAtivo = null;

  // Esconde de vez só quando a animação terminar, para sair da ordem de foco.
  // O tempo acompanha --dur-4 em tokens.css.
  window.clearTimeout(fechandoPainel);
  fechandoPainel = window.setTimeout(() => show(painel, false), 440);

  // Devolve o foco ao marcador de onde veio, sem mexer na rolagem.
  if (anterior) {
    qs<HTMLElement>(`.marker[data-id="${anterior}"]`)?.focus({ preventScroll: true });
  }
}

/* ===========================================================================
   Ligações
   =========================================================================== */

export function iniciarMapa(): void {
  // A foto pode faltar (caminho errado, deploy incompleto): os marcadores
  // continuam funcionando sobre o fundo de aviso, nas posições salvas.
  const foto = el<HTMLImageElement>('map-foto');
  foto?.addEventListener('error', () => {
    foto.hidden = true;
    show(el('map-fallback'), true);
  });

  // Esc fecha a ficha, desde que nenhum modal esteja na frente.
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape' || modalAberto()) return;
    fecharPainel();
  });

  // Clique fora fecha a ficha. Clique no marcador ou dentro dela, não.
  document.addEventListener('click', (ev) => {
    if (modalAberto()) return;
    const alvo = ev.target;
    if (!(alvo instanceof Element)) return;
    if (alvo.closest('.marker') || alvo.closest('#painel')) return;
    fecharPainel();
  });
}
