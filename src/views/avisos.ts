/**
 * Sino de avisos, no canto do mapa (no lugar da antiga tela cheia).
 *
 * O back-end calcula os avisos na hora: reserva acabando (com marcos
 * proporcionais ao tamanho dela), reserva aprovada ou cancelada, convites,
 * propostas — e, para a administração, o que está esperando por ela.
 *
 * Abrir o sino marca tudo como lido: o contador zera, mas os avisos que eram
 * novos continuam destacados até a próxima abertura.
 */
import { el, setText, show } from '../lib/dom';
import { html, icone, juntar, raw } from '../lib/html';
import { dataHoraBR } from '../lib/format';
import { irParaSecao, type Secao } from '../lib/navegacao';
import { getAvisos, marcarAvisosLidos, type AvisoApi } from '../services/api';
import { alternarPopover } from './mapa';
import { abrirConvites } from './convites';
import { filtrarReservas } from './admin';

let avisos: AvisoApi[] = [];
let lendo: Promise<void> | null = null;
let relogio: number | null = null;

const ICONE_DO_TIPO: Record<string, string> = {
  reserva_acabando: 'clock',
  reserva_acabou: 'calendar-check',
  reserva_aprovada: 'circle-check',
  reserva_cancelada: 'ban',
  convite_recebido: 'send-horizontal',
  convite_respondido: 'users',
  projeto_aprovado: 'circle-check',
  projeto_recusado: 'ban',
  adm_reservas_pendentes: 'calendar-plus',
  adm_propostas_pendentes: 'graduation-cap',
  adm_sem_senha: 'user-plus',
  adm_sem_lider: 'shield-user',
};

function pintarContador(n: number): void {
  const badge = el('map-avisos-conta');
  if (!badge) return;
  badge.textContent = n > 9 ? '9+' : String(n);
  show(badge, n > 0);
  el('map-btn-avisos')?.setAttribute('aria-label', n ? `Avisos, ${n} não lidos` : 'Avisos');
}

/** Relê os avisos (só um pedido por vez) e acerta o contador do sino. */
export function atualizarAvisos(): Promise<void> {
  lendo ??= getAvisos()
    .then((r) => {
      avisos = r.avisos;
      pintarContador(r.nao_lidas);
      pintarLista();
    })
    .catch(() => undefined)
    .finally(() => {
      lendo = null;
    });
  return lendo;
}

/** Depois do login: lê agora e de novo a cada 5 minutos enquanto a sessão durar. */
export function ligarAvisos(): void {
  void atualizarAvisos();
  if (relogio === null) relogio = window.setInterval(() => void atualizarAvisos(), 5 * 60 * 1000);
}

export function desligarAvisos(): void {
  if (relogio !== null) window.clearInterval(relogio);
  relogio = null;
  avisos = [];
  pintarContador(0);
}

/** Clique no sino: abre a lista e dá tudo por lido. */
export async function abrirAvisos(botao: HTMLElement): Promise<void> {
  const pop = el('map-pop-avisos');
  const abrindo = Boolean(pop?.hidden);
  alternarPopover(botao);
  if (!abrindo) return;

  pintarLista();
  await atualizarAvisos();

  if (avisos.some((a) => !a.lida)) {
    pintarContador(0);
    void marcarAvisosLidos('todas').catch(() => undefined);
  }
}

function pintarLista(): void {
  const lista = el('map-avisos-lista');
  if (!lista) return;

  const novos = avisos.filter((a) => !a.lida).length;
  setText('map-avisos-resumo', novos ? `${novos} ${novos === 1 ? 'novo' : 'novos'}` : '');

  if (!avisos.length) {
    lista.innerHTML = html`<li class="avisos__vazio">Nada por aqui. Avisos de reservas, convites e pendências aparecem neste sino.</li>`;
    return;
  }

  lista.innerHTML = juntar(avisos.map((a, i) => html`
    <li>
      <button type="button" class="aviso ${raw(a.lida ? '' : 'is-novo')}" data-tom="${a.tom}"
              data-action="ir-aviso" data-indice="${String(i)}">
        <span class="aviso__icone">${icone(ICONE_DO_TIPO[a.tipo] ?? 'info', 'ic ic--sm')}</span>
        <span class="aviso__corpo">
          <span class="aviso__titulo">${a.titulo}</span>
          <span class="aviso__texto">${a.texto}</span>
          ${raw(a.quando ? html`<span class="aviso__quando">${dataHoraBR(a.quando)}</span>` : '')}
        </span>
      </button>
    </li>`));
}

const SECOES: Secao[] = ['mapa', 'reservas', 'projetos', 'usuarios', 'admin', 'historico'];

/** Clique num aviso: leva à tela do assunto. */
export function irParaAviso(indice: number): void {
  const aviso = avisos[indice];
  if (!aviso) return;

  const secao = aviso.link.secao as Secao;
  if (!SECOES.includes(secao)) return;

  const pop = el('map-pop-avisos');
  const botao = el('map-btn-avisos');
  if (pop && botao && !pop.hidden) alternarPopover(botao);

  irParaSecao(secao);
  if (secao === 'reservas' && aviso.link.filtro === 'pendente') filtrarReservas('pendente');
  if (aviso.link.convites) abrirConvites();
}
