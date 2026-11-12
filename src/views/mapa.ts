/**
 * Mapa do campus.
 *
 * A foto aérea e os marcadores ficam num palco único, que o zoom e o arrasto
 * movem. Cada espaço é um <button> do tamanho do próprio prédio, posicionado em
 * porcentagem da foto, com nome acessível completo ("Estufa 03, ocupada") e
 * alcançável por teclado. Acionar abre a ficha lateral.
 *
 * Por cima do palco ficam a busca, os botões de camadas, filtro e tela cheia,
 * a legenda e o zoom.
 */
import { ESTUFAS, aceitaReserva, proximasReservas, reservasDoEspaco } from '../data/estufas';
import { HOTSPOTS, pegada, type Pegada } from '../data/hotspots';
import { el, qs, qsa, setText, show } from '../lib/dom';
import { html, icone, juntar, raw } from '../lib/html';
import { capacidade, dataBR, statusInfo, statusPill } from '../lib/format';
import { modalAberto } from '../lib/modal';
import { aviso } from '../lib/toast';
import type { Estufa, EstufaStatus, Reserva } from '../types';
import { motivoParaNaoReservar } from '../data/contexto';

let espacoAtivo: string | null = null;
let fechandoPainel: number | undefined;

/** Centro e tamanho de cada prédio, pela chave do mapa (E01...). */
const PEGADAS = new Map<string, Pegada>(HOTSPOTS.map((h) => [h.id, pegada(h)]));

/* ===========================================================================
   Valores derivados
   =========================================================================== */

/** As quatro cores da legenda. Cada status visível cai em uma delas. */
type Grupo = 'livre' | 'ocupada' | 'reservada' | 'manutencao';

const GRUPOS: Grupo[] = ['livre', 'ocupada', 'reservada', 'manutencao'];

/**
 * Parcial ainda aceita reserva, por isso entra com os livres; inativa não
 * aceita, e vai com manutenção.
 */
function grupoDe(status: EstufaStatus | 'indefinido'): Grupo {
  if (status === 'ocupada') return 'ocupada';
  if (status === 'reservada') return 'reservada';
  if (status === 'manutencao' || status === 'inativa' || status === 'indefinido') return 'manutencao';
  return 'livre';
}

function nomeAcessivel(id: string): string {
  const estufa = ESTUFAS[id];
  if (!estufa) return `${id}, sem dados`;
  return `${estufa.nome}, ${statusInfo(estufa.status).label.toLowerCase()}`;
}

/** "06/11 a 13/11/2026": o ano só se repete quando muda. */
function periodo(inicio: string, fim: string): string {
  if (!inicio || !fim) return dataBR(inicio || fim);
  const mesmoAno = inicio.slice(0, 4) === fim.slice(0, 4);
  const de = mesmoAno ? dataBR(inicio).slice(0, 5) : dataBR(inicio);
  return `${de} a ${dataBR(fim)}`;
}

function projetoDa(reserva: Reserva): string {
  if (reserva.projeto && reserva.projetoTitulo) return `${reserva.projeto} — ${reserva.projetoTitulo}`;
  return reserva.projeto || reserva.finalidade || 'Sem projeto vinculado';
}

/** Tira acento e caixa, para "manutencao" achar "Manutenção". */
function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/* ===========================================================================
   Marcadores
   =========================================================================== */

/** Grupos que o filtro deixa à vista. Começa com todos. */
const filtro = new Set<Grupo>(GRUPOS);

export function renderizarMarcadores(): void {
  const camada = el('map-marcadores');
  if (!camada) return;

  const fragmento = document.createDocumentFragment();

  for (const { id } of HOTSPOTS) {
    const estufa = ESTUFAS[id];
    const area = PEGADAS.get(id);
    if (!area) continue;

    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'marker';
    botao.dataset.action = 'abrir-espaco';
    botao.dataset.id = id;
    botao.dataset.status = estufa ? estufa.status : 'indefinido';
    botao.style.left = `${area.cx}%`;
    botao.style.top = `${area.cy}%`;
    botao.style.width = `${area.w}%`;
    botao.style.height = `${area.h}%`;
    botao.setAttribute('aria-controls', 'painel');
    botao.setAttribute('aria-expanded', String(id === espacoAtivo));
    botao.setAttribute('aria-label', nomeAcessivel(id));

    const nome = document.createElement('span');
    nome.className = 'marker__name';
    nome.setAttribute('aria-hidden', 'true');
    nome.textContent = estufa ? estufa.nome : id;

    const ponto = document.createElement('span');
    ponto.className = 'marker__dot';

    // Alfinete do espaço selecionado; o CSS só o mostra com a ficha aberta.
    const pino = document.createElement('span');
    pino.className = 'marker__pin';
    pino.setAttribute('aria-hidden', 'true');
    pino.innerHTML = html`${icone('warehouse')}`;

    botao.append(nome, ponto, pino);
    fragmento.append(botao);
  }

  camada.replaceChildren(fragmento);
  aplicarFiltro();
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

  aplicarFiltro();

  // A ficha aberta reflete a mudança na hora.
  if (espacoAtivo && ESTUFAS[espacoAtivo]) preencherPainel(espacoAtivo);
}

function marcarSelecionado(id: string | null): void {
  for (const botao of qsa<HTMLButtonElement>('.marker')) {
    botao.setAttribute('aria-expanded', String(botao.dataset.id === id));
  }
}

/**
 * Esconde os marcadores dos grupos desmarcados e atualiza a contagem de cada
 * grupo no popover. O espaço com a ficha aberta nunca some debaixo dela.
 */
function aplicarFiltro(): void {
  const contagem: Record<Grupo, number> = { livre: 0, ocupada: 0, reservada: 0, manutencao: 0 };

  for (const botao of qsa<HTMLButtonElement>('.marker')) {
    const grupo = grupoDe((botao.dataset.status ?? 'indefinido') as EstufaStatus | 'indefinido');
    contagem[grupo] += 1;
    botao.hidden = !filtro.has(grupo) && botao.dataset.id !== espacoAtivo;
  }

  for (const grupo of GRUPOS) {
    const alvo = document.getElementById(`map-conta-${grupo}`);
    if (alvo) alvo.textContent = String(contagem[grupo]);
  }

  // O botão avisa que há algo escondido, para ninguém achar que faltam estufas.
  el('map-btn-filtro')?.toggleAttribute('data-ativo', filtro.size < GRUPOS.length);
}

/* ===========================================================================
   Zoom e arrasto
   =========================================================================== */

const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
const PASSO_ZOOM = 1.5;

/** Onde o palco está: escala e deslocamento em px, a partir do canto. */
const vista = { zoom: 1, x: 0, y: 0 };

function tamanhoDoMapa(): { w: number; h: number } {
  const viewport = document.getElementById('map-viewport');
  return { w: viewport?.clientWidth ?? 0, h: viewport?.clientHeight ?? 0 };
}

/**
 * Largura que a ficha aberta cobre. O mapa pode deslizar esse tanto para a
 * esquerda, para que um espaço da borda direita não fique escondido atrás dela.
 * Em tela estreita a ficha ocupa tudo e não há para onde deslizar.
 */
function folgaDaFicha(): number {
  if (!espacoAtivo) return 0;
  const painel = document.getElementById('painel');
  const { w } = tamanhoDoMapa();
  const largura = painel?.offsetWidth ?? 0;
  return largura > 0 && largura < w * 0.7 ? largura : 0;
}

function limitarVista(): void {
  const { w, h } = tamanhoDoMapa();
  vista.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, vista.zoom));
  vista.x = Math.min(0, Math.max(w - w * vista.zoom - folgaDaFicha(), vista.x));
  vista.y = Math.min(0, Math.max(h - h * vista.zoom, vista.y));
}

function aplicarVista(animar = false): void {
  const palco = document.getElementById('map-palco');
  if (!palco) return;

  limitarVista();
  palco.classList.toggle('is-animating', animar);
  palco.style.transform = `translate(${vista.x}px, ${vista.y}px) scale(${vista.zoom})`;
  // Pontos, rótulos e alfinete dividem por isto para manter o tamanho na tela.
  palco.style.setProperty('--zoom', String(vista.zoom));

  const mais = document.getElementById('map-zoom-mais') as HTMLButtonElement | null;
  const menos = document.getElementById('map-zoom-menos') as HTMLButtonElement | null;
  if (mais) mais.disabled = vista.zoom >= ZOOM_MAX;
  if (menos) menos.disabled = vista.zoom <= ZOOM_MIN;
}

/** Muda o zoom mantendo parado o ponto (px, py) da tela. */
function zoomEm(novoZoom: number, px: number, py: number, animar: boolean): void {
  const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, novoZoom));
  const razao = zoom / vista.zoom;
  vista.x = px - (px - vista.x) * razao;
  vista.y = py - (py - vista.y) * razao;
  vista.zoom = zoom;
  aplicarVista(animar);
}

/** Botões + e −: aproximam ou afastam a partir do meio da área visível. */
export function ajustarZoom(direcao: string): void {
  const { w, h } = tamanhoDoMapa();
  const fator = direcao === 'mais' ? PASSO_ZOOM : 1 / PASSO_ZOOM;
  zoomEm(vista.zoom * fator, (w - folgaDaFicha()) / 2, h / 2, true);
  // Com a ficha aberta, o zoom acompanha o espaço que ela mostra.
  if (espacoAtivo) focarEspaco(espacoAtivo, true);
}

/**
 * Traz um espaço para a área visível. Com `centro`, põe no meio; sem, só mexe o
 * mínimo necessário quando ele está fora da vista ou atrás da ficha.
 */
function focarEspaco(id: string, centro: boolean): void {
  const area = PEGADAS.get(id);
  if (!area) return;

  const { w, h } = tamanhoDoMapa();
  const visivel = w - folgaDaFicha();
  const px = (area.cx / 100) * w * vista.zoom;
  const py = (area.cy / 100) * h * vista.zoom;

  if (centro) {
    vista.x = visivel / 2 - px;
    vista.y = h / 2 - py;
  } else {
    // Margens: a de cima deixa passar a busca e o alfinete.
    const margem = 72;
    const topo = 132;
    const naTelaX = px + vista.x;
    const naTelaY = py + vista.y;
    if (naTelaX > visivel - margem) vista.x -= naTelaX - (visivel - margem);
    if (naTelaX < margem) vista.x += margem - naTelaX;
    if (naTelaY < topo) vista.y += topo - naTelaY;
    if (naTelaY > h - margem) vista.y -= naTelaY - (h - margem);
  }

  aplicarVista(true);
}

/** Botão de recentralizar: volta ao espaço aberto ou, sem ficha, à foto inteira. */
export function centralizarMapa(): void {
  if (espacoAtivo) {
    focarEspaco(espacoAtivo, true);
    return;
  }
  vista.zoom = 1;
  vista.x = 0;
  vista.y = 0;
  aplicarVista(true);
}

function ligarZoomEArrasto(): void {
  const viewport = document.getElementById('map-viewport');
  if (!viewport) return;

  viewport.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const caixa = viewport.getBoundingClientRect();
    const fator = Math.exp(-ev.deltaY * 0.0016);
    zoomEm(vista.zoom * fator, ev.clientX - caixa.left, ev.clientY - caixa.top, false);
  }, { passive: false });

  // Arrasto. Só vira arrasto depois de alguns px, para o clique no marcador
  // continuar sendo clique; e o clique que encerra um arrasto é engolido.
  let inicio: { x: number; y: number; vx: number; vy: number; id: number } | null = null;
  let arrastou = false;

  viewport.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    arrastou = false;
    inicio = { x: ev.clientX, y: ev.clientY, vx: vista.x, vy: vista.y, id: ev.pointerId };
  });

  viewport.addEventListener('pointermove', (ev) => {
    if (!inicio || ev.pointerId !== inicio.id) return;
    const dx = ev.clientX - inicio.x;
    const dy = ev.clientY - inicio.y;

    if (!arrastou) {
      if (Math.hypot(dx, dy) < 5) return;
      arrastou = true;
      viewport.setPointerCapture(ev.pointerId);
      viewport.classList.add('is-dragging');
    }

    vista.x = inicio.vx + dx;
    vista.y = inicio.vy + dy;
    aplicarVista(false);
  });

  const soltar = (ev: PointerEvent): void => {
    if (!inicio || ev.pointerId !== inicio.id) return;
    inicio = null;
    viewport.classList.remove('is-dragging');
  };
  viewport.addEventListener('pointerup', soltar);
  viewport.addEventListener('pointercancel', soltar);

  viewport.addEventListener('click', (ev) => {
    if (!arrastou) return;
    arrastou = false;
    ev.preventDefault();
    ev.stopPropagation();
  }, true);

  // Mudou o tamanho da janela (ou entrou em tela cheia): o deslocamento em px
  // deixa de valer e precisa voltar para dentro dos limites.
  new ResizeObserver(() => aplicarVista(false)).observe(viewport);
}

/* ===========================================================================
   Busca
   =========================================================================== */

const MAX_RESULTADOS = 6;

let resultados: string[] = [];
let resultadoAtivo = -1;

/** Espaços do mapa que casam com o termo: nome, código, tipo, setor, projeto ou responsável. */
function buscarEspacos(termo: string): string[] {
  const alvo = normalizar(termo);
  if (!alvo) return [];

  const achados: { id: string; peso: number }[] = [];

  for (const { id } of HOTSPOTS) {
    const estufa = ESTUFAS[id];
    if (!estufa) continue;

    const nome = normalizar(estufa.nome);
    const codigo = normalizar(estufa.codigo);
    const resto = normalizar([
      estufa.tipo,
      estufa.setor ?? '',
      ...proximasReservas(id).flatMap((r) => [r.projeto, r.projetoTitulo ?? '', r.pesquisador ?? '', r.id]),
    ].join(' '));

    // Quem casa pelo começo do nome ou do código vem antes de quem só contém.
    let peso = -1;
    if (nome.startsWith(alvo) || codigo.startsWith(alvo)) peso = 0;
    else if (nome.includes(alvo) || codigo.includes(alvo)) peso = 1;
    else if (resto.includes(alvo)) peso = 2;

    if (peso >= 0) achados.push({ id, peso });
  }

  return achados
    .sort((a, b) => a.peso - b.peso || a.id.localeCompare(b.id))
    .slice(0, MAX_RESULTADOS)
    .map((a) => a.id);
}

function pintarResultados(): void {
  const campo = el<HTMLInputElement>('map-busca');
  const lista = el('map-busca-lista');
  if (!campo || !lista) return;

  const termo = campo.value.trim();
  const aberta = termo !== '';
  resultados = buscarEspacos(termo);
  resultadoAtivo = resultados.length ? 0 : -1;

  show(lista, aberta);
  campo.setAttribute('aria-expanded', String(aberta));

  // A caixa é um quadrado com a lupa até receber foco. Com texto digitado ela
  // continua aberta mesmo sem foco, senão encolheria por cima dos resultados.
  el('map-busca-caixa')?.classList.toggle('is-preenchida', aberta);

  if (!aberta) {
    lista.replaceChildren();
    campo.removeAttribute('aria-activedescendant');
    return;
  }

  if (!resultados.length) {
    lista.innerHTML = html`<li class="map-search__empty" role="presentation">Nenhum espaço encontrado para “${termo}”.</li>`;
    campo.removeAttribute('aria-activedescendant');
    return;
  }

  lista.innerHTML = juntar(resultados.map((id, indice) => {
    const estufa = ESTUFAS[id];
    const atual = reservasDoEspaco(id)[0];
    const detalhe = [estufa.codigo, estufa.tipo, atual?.projeto].filter(Boolean).join(' · ');
    return html`
      <li class="map-search__option" id="map-busca-op-${indice}" role="option"
          aria-selected="${indice === resultadoAtivo}"
          data-action="mapa-resultado" data-id="${id}">
        <span class="map-search__tile">${icone('warehouse')}</span>
        <span class="map-search__text">
          <span class="map-search__name">${estufa.nome}</span>
          <span class="map-search__meta">${detalhe}</span>
        </span>
        ${statusPill(estufa.status)}
      </li>`;
  }));

  campo.setAttribute('aria-activedescendant', `map-busca-op-${resultadoAtivo}`);
}

function moverResultado(passo: number): void {
  if (!resultados.length) return;
  resultadoAtivo = (resultadoAtivo + passo + resultados.length) % resultados.length;

  qsa('.map-search__option').forEach((opcao, indice) => {
    opcao.setAttribute('aria-selected', String(indice === resultadoAtivo));
    if (indice === resultadoAtivo) opcao.scrollIntoView({ block: 'nearest' });
  });
  el('map-busca')?.setAttribute('aria-activedescendant', `map-busca-op-${resultadoAtivo}`);
}

function limparBusca(): void {
  const campo = el<HTMLInputElement>('map-busca');
  if (!campo) return;
  campo.value = '';
  pintarResultados();
}

/** Resultado escolhido: abre a ficha e leva o mapa até o espaço. */
export function escolherResultado(id: string): void {
  limparBusca();
  el<HTMLInputElement>('map-busca')?.blur();
  abrirPainel(id, true);
}

function ligarBusca(): void {
  const campo = el<HTMLInputElement>('map-busca');
  if (!campo) return;

  // No Mac o atalho é ⌘K; a dica acompanha.
  if (/mac|iphone|ipad/i.test(navigator.userAgent)) {
    const atalho = el('map-busca-atalho');
    if (atalho) atalho.innerHTML = '<kbd>⌘</kbd><kbd>K</kbd>';
  }

  campo.addEventListener('input', pintarResultados);
  campo.addEventListener('focus', pintarResultados);

  // A caixa cresce ao receber foco e encolhe ao sair sem nada digitado. O CSS
  // ja faz isso com :focus-within; a classe e o mesmo gatilho por JS, para o
  // comportamento nao depender do suporte do navegador ao seletor.
  const caixa = el('map-busca-caixa');
  campo.addEventListener('focus', () => caixa?.classList.add('is-aberta'));
  campo.addEventListener('blur', () => {
    if (!campo.value.trim()) caixa?.classList.remove('is-aberta');
  });

  campo.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      moverResultado(ev.key === 'ArrowDown' ? 1 : -1);
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      const id = resultados[resultadoAtivo];
      if (id) escolherResultado(id);
    } else if (ev.key === 'Escape' && campo.value) {
      // Primeiro Esc limpa a busca; a ficha, se aberta, só fecha no seguinte.
      ev.stopPropagation();
      limparBusca();
    }
  });

  // Ctrl+K (ou ⌘K) leva à busca, só na tela do mapa e sem modal na frente.
  document.addEventListener('keydown', (ev) => {
    if (!(ev.ctrlKey || ev.metaKey) || ev.key.toLowerCase() !== 'k') return;
    if (modalAberto() || !el('view-mapa')?.classList.contains('is-active')) return;
    if (el('app')?.hidden) return;
    ev.preventDefault();
    campo.focus();
    campo.select();
  });
}

/* ===========================================================================
   Camadas, filtro e tela cheia
   =========================================================================== */

function fecharPopovers(excecao?: string): void {
  for (const pop of qsa('.map-pop')) {
    if (pop.id === excecao) continue;
    show(pop, false);
    qs(`[aria-controls="${pop.id}"]`)?.setAttribute('aria-expanded', 'false');
  }
}

/** Abre ou fecha o popover de um botão da barra (camadas ou filtro). */
export function alternarPopover(botao: HTMLElement): void {
  const id = botao.dataset.alvo;
  const pop = id ? el(id) : null;
  if (!pop) return;

  const abrir = pop.hidden;
  fecharPopovers(pop.id);
  show(pop, abrir);
  botao.setAttribute('aria-expanded', String(abrir));
}

function ligarPopovers(): void {
  document.addEventListener('change', (ev) => {
    const alvo = ev.target;
    if (!(alvo instanceof HTMLInputElement)) return;

    const grupo = alvo.dataset.filtro as Grupo | undefined;
    if (grupo) {
      if (alvo.checked) filtro.add(grupo);
      else filtro.delete(grupo);
      aplicarFiltro();
      return;
    }

    const camada = alvo.dataset.camada;
    if (camada) el('mapa')?.toggleAttribute(`data-sem-${camada}`, !alvo.checked);
  });
}

/* ===========================================================================
   Ficha do espaço
   =========================================================================== */

/** Quantas reservas a lista mostra antes de "Ver todas". */
const RESERVAS_VISIVEIS = 2;

let mostrarTodas = false;

/** Rótulo da reserva na ficha: quem pediu vê "Aprovada", não "Ativa". */
function pillDaReserva(reserva: Reserva): ReturnType<typeof raw> {
  if (reserva.status === 'ativa') {
    return raw(html`<span class="pill pill--ok">${icone('check', 'ic ic--sm')}Aprovada</span>`);
  }
  return statusPill(reserva.status);
}

/**
 * Enquadra o prédio na foto aérea. A imagem é a mesma do mapa, ampliada, com
 * o espaço no meio do quadro — o cadastro ainda não guarda foto por estufa.
 */
function enquadrarFoto(id: string): void {
  const quadro = el('painel-foto');
  const area = PEGADAS.get(id);
  if (!quadro || !area) return;

  // A imagem entra com 4,2x a largura do quadro. Em altura, isso depende da
  // proporção da foto (1296×1162) e da do quadro, definida no CSS.
  const ampliacao = 4.2;
  const proporcaoFoto = 1296 / 1162;
  const proporcaoQuadro = 2.9;
  const ampliacaoY = (ampliacao * proporcaoQuadro) / proporcaoFoto;

  const posicao = (ponto: number, fator: number): number => {
    const bruto = (0.5 - (ponto / 100) * fator) / (1 - fator);
    return Math.min(1, Math.max(0, bruto)) * 100;
  };

  quadro.style.backgroundSize = `${ampliacao * 100}% auto`;
  quadro.style.backgroundPosition = `${posicao(area.cx, ampliacao)}% ${posicao(area.cy, ampliacaoY)}%`;
}

function preencherCapacidade(estufa: Estufa): void {
  const unidade = estufa.unidade === 'VASO' ? 'vasos' : 'bancadas';
  setText('painel-capacidade-titulo', `Capacidade (${unidade})`);

  const arco = document.getElementById('painel-arco');
  const total = estufa.capacidadeTotal;

  if (total <= 0) {
    setText('painel-capacidade', '—');
    setText('painel-em-uso', 'Sem capacidade');
    setText('painel-disponiveis', 'cadastrada');
    arco?.setAttribute('stroke-dasharray', '0 100');
    arco?.toggleAttribute('hidden', true);
    return;
  }

  const emUso = Math.min(estufa.ocupado, total);
  setText('painel-capacidade', `${emUso}/${total}`);
  setText('painel-em-uso', `${emUso} em uso`);
  setText('painel-disponiveis', `${estufa.disponivel} ${estufa.disponivel === 1 ? 'disponível' : 'disponíveis'}`);
  // O círculo tem perímetro 100: o traço é a própria porcentagem.
  arco?.setAttribute('stroke-dasharray', `${(emUso / total) * 100} 100`);
  // Traço de ponta redonda com comprimento zero ainda desenha um ponto.
  arco?.toggleAttribute('hidden', emUso === 0);
}

function preencherProximas(id: string, estufa: Estufa): void {
  const lista = el('painel-proximas');
  if (!lista) return;

  const todas = proximasReservas(id);
  const visiveis = mostrarTodas ? todas : todas.slice(0, RESERVAS_VISIVEIS);

  lista.innerHTML = juntar(visiveis.map((reserva) => html`
    <li>
      <button type="button" class="booking" data-action="ver-reserva" data-id="${reserva.id}">
        <span class="booking__tile">${icone('calendar-days')}</span>
        <span class="booking__text">
          <span class="booking__title">${reserva.id}${reserva.projeto ? ` — ${reserva.projeto}` : ''}</span>
          <span class="booking__meta">${capacidade(reserva.quantidade, estufa.unidade)}</span>
        </span>
        <span class="booking__side">
          ${pillDaReserva(reserva)}
          <span class="booking__dates">${periodo(reserva.data, reserva.dataFim)}</span>
        </span>
      </button>
    </li>`));

  show(el('painel-proximas-vazio'), todas.length === 0);

  const verTodas = el('painel-ver-todas');
  show(verTodas, todas.length > RESERVAS_VISIVEIS);
  verTodas?.setAttribute('aria-expanded', String(mostrarTodas));
  setText('painel-ver-todas-rotulo', mostrarTodas ? 'Ver menos' : `Ver todas (${todas.length})`);
}

/** "Ver todas" abre a lista inteira dentro da própria ficha. */
export function alternarProximas(): void {
  if (!espacoAtivo || !ESTUFAS[espacoAtivo]) return;
  mostrarTodas = !mostrarTodas;
  preencherProximas(espacoAtivo, ESTUFAS[espacoAtivo]);
}

function preencherPainel(id: string): void {
  const estufa = ESTUFAS[id];
  const painel = el('painel');
  if (!estufa || !painel) return;

  painel.dataset.status = estufa.status;

  setText('painel-codigo', estufa.codigo);
  setText('painel-nome', estufa.nome);
  setText('painel-tipo', estufa.tipo || '—');
  setText('painel-area', estufa.area);

  const status = el('painel-status');
  if (status) status.innerHTML = html`${statusPill(estufa.status)}`;

  enquadrarFoto(id);
  preencherCapacidade(estufa);

  // Ocupação de hoje. Com a reserva parcial várias convivem no mesmo período:
  // a ficha mostra a maior e conta as outras; todas aparecem na lista abaixo.
  const atuais = reservasDoEspaco(id);
  const reserva = atuais[0];
  const outras = atuais.length - 1;
  const mais = outras > 0 ? ` (+${outras})` : '';

  setText('painel-projeto', reserva ? `${projetoDa(reserva)}${mais}` : 'Sem ocupação hoje');
  setText('painel-responsavel', reserva?.pesquisador?.trim() || '—');
  setText('painel-periodo', reserva ? `${dataBR(reserva.data)} a ${dataBR(reserva.dataFim)}` : '—');

  preencherProximas(id, estufa);
  configurarAcao(estufa, id, reserva?.id);
}

/** Recado abaixo do botão quando a pessoa ainda não pode reservar. */
function mostrarImpedimento(motivo: string | null): void {
  const aviso = el('painel-impedimento');
  if (!aviso) return;

  setText('painel-impedimento-texto', motivo ?? '');
  show(aviso, Boolean(motivo));
}

function configurarAcao(estufa: Estufa, id: string, reservaId?: string): void {
  const botao = el<HTMLButtonElement>('painel-acao');
  if (!botao) return;

  botao.disabled = false;
  botao.className = 'btn btn--primary btn--block panel__cta';
  delete botao.dataset.id;

  if (aceitaReserva(estufa)) {
    // Reservar exige um projeto aprovado com permissão de criar reserva. Sem
    // isso o botão abriria um formulário que a API ia recusar no fim — então
    // ele explica o que falta, em vez de deixar a pessoa preencher à toa.
    const impedimento = motivoParaNaoReservar();

    botao.dataset.action = impedimento ? 'sem-acao' : 'abrir-reservar';
    botao.dataset.id = id;
    botao.disabled = Boolean(impedimento);
    botao.innerHTML = html`${icone('calendar-plus')}Solicitar reserva`;
    mostrarImpedimento(impedimento);
    return;
  }

  mostrarImpedimento(null);

  if (reservaId) {
    botao.dataset.action = 'ver-reserva';
    botao.dataset.id = reservaId;
    botao.className = 'btn btn--quiet btn--block panel__cta';
    botao.innerHTML = html`${icone('eye')}Ver a reserva`;
    return;
  }

  const status = statusInfo(estufa.status);
  botao.dataset.action = 'sem-acao';
  botao.className = 'btn btn--quiet btn--block panel__cta';
  botao.disabled = true;
  botao.innerHTML = html`${icone(status.icon)}${status.label}`;
}

/**
 * Abre a ficha. `centralizar` leva o mapa até o espaço (quem veio pela busca
 * pode estar olhando para outro canto); sem ele o mapa só se mexe se o espaço
 * fosse ficar escondido atrás da ficha.
 */
export function abrirPainel(id: string, centralizar = false): void {
  if (!ESTUFAS[id]) {
    aviso('Os dados deste espaço ainda não foram carregados.', 'error');
    return;
  }

  const painel = el('painel');
  if (!painel) return;

  window.clearTimeout(fechandoPainel);
  if (espacoAtivo !== id) mostrarTodas = false;
  espacoAtivo = id;
  fecharPopovers();
  preencherPainel(id);
  marcarSelecionado(id);
  aplicarFiltro();

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

  focarEspaco(id, centralizar);
}

export function fecharPainel(): void {
  const painel = el('painel');
  if (!painel || !painel.classList.contains('is-open')) return;

  const anterior = espacoAtivo;
  painel.classList.remove('is-open');
  marcarSelecionado(null);
  espacoAtivo = null;
  aplicarFiltro();
  // Sem a ficha, o mapa volta para dentro dos próprios limites.
  aplicarVista(true);

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

  ligarZoomEArrasto();
  ligarBusca();
  ligarPopovers();
  aplicarVista(false);

  // Esc fecha primeiro o que estiver por cima (popover), depois a ficha —
  // desde que nenhum modal esteja na frente.
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape' || modalAberto()) return;
    if (qsa('.map-pop').some((pop) => !pop.hidden)) {
      fecharPopovers();
      return;
    }
    fecharPainel();
  });

  document.addEventListener('click', (ev) => {
    if (modalAberto()) return;
    const alvo = ev.target;
    if (!(alvo instanceof Element)) return;

    // Clique fora da busca recolhe a lista; fora dos botões, os popovers.
    if (!alvo.closest('#map-busca-caixa')) {
      show(document.getElementById('map-busca-lista'), false);
      document.getElementById('map-busca')?.setAttribute('aria-expanded', 'false');
    }
    if (!alvo.closest('.map-tools__item')) fecharPopovers();

    // Clique na foto fecha a ficha. Em marcador, na ficha ou nos controles
    // (zoom, busca, legenda), não.
    if (alvo.closest('.marker') || !alvo.closest('#map-viewport')) return;
    fecharPainel();
  });
}
