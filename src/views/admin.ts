/**
 * Administração: métricas, espaços, reservas e usuários.
 *
 * O acesso é verificado a cada render, não só na navegação.
 */
import { ESTUFAS, reservaDoEspaco, reservas, reservasVigentes, salvarEstado } from '../data/estufas';
import { dadosMudaram } from '../lib/bus';
import { el, qsa, setText, show } from '../lib/dom';
import { html, icone, juntar, raw } from '../lib/html';
import { dataBR, statusInfo, statusPill } from '../lib/format';
import { abrirModal, confirmar, fecharTodosModais, trocarModal } from '../lib/modal';
import { aviso } from '../lib/toast';
import { liberarEspacoSeVazio } from './reservas';
import {
  cadastrarUsuario,
  excluirUsuario,
  listarUsuarios,
  usuarioAtual,
} from './login';
import type { EstufaStatus, PerfilUsuario, ReservaStatus } from '../types';

type FiltroReserva = 'todas' | 'pendente' | 'ativa';

const STATUS_ESPACO: EstufaStatus[] = ['livre', 'ocupada', 'reservada', 'manutencao'];

let buscaEspacos = '';
let buscaReservas = '';
let filtroReservas: FiltroReserva = 'todas';
let perfilNovoUsuario: PerfilUsuario = 'pesquisador';

function ehAdmin(): boolean {
  return usuarioAtual()?.admin === true;
}

export function renderizarAdmin(): void {
  if (!ehAdmin()) return;
  renderizarMetricas();
  renderizarEspacos();
  renderizarReservas();
  renderizarUsuarios();
}

/* ===========================================================================
   Métricas
   =========================================================================== */

function renderizarMetricas(): void {
  const espacos = Object.values(ESTUFAS);
  const total = espacos.length;
  const livres = espacos.filter((e) => e.status === 'livre').length;
  const ocupados = espacos.filter(
    (e) => e.status === 'ocupada' || e.status === 'reservada',
  ).length;
  const manutencao = espacos.filter((e) => e.status === 'manutencao').length;
  const emAberto = reservas.filter(
    (r) => r.status === 'ativa' || r.status === 'pendente',
  ).length;
  const taxa = total ? Math.round((ocupados / total) * 100) : 0;

  setText('m-total', String(total));
  setText('m-livres', String(livres));
  setText('m-reservas', String(emAberto));
  setText('m-manutencao', String(manutencao));
  setText('m-taxa', `${taxa}%`);

  const barra = el('m-taxa-barra');
  if (barra) barra.style.width = `${taxa}%`;
  el('m-taxa-barra-wrap')?.setAttribute('aria-valuenow', String(taxa));
}

/* ===========================================================================
   Espaços
   =========================================================================== */

/**
 * Quem está com o espaço, para a coluna "Reservado por".
 *
 * Mostra o responsável da reserva vigente, o período e, quando ela ainda não
 * foi aprovada, o aviso de pendente. Espaço sem reserva fica com travessão —
 * inclusive em manutenção, que não tem responsável.
 */
function celulaReservadoPor(id: string): string {
  const reserva = reservaDoEspaco(id);
  if (!reserva) return html`<span class="table__muted">&mdash;</span>`;

  const nome = reserva.pesquisador?.trim() || 'Responsável não informado';
  const periodo = `${dataBR(reserva.data)} a ${dataBR(reserva.dataFim)}`;

  return html`
    <div class="table__stack">
      <span class="table__name">${nome}</span>
      <span class="table__sub">
        ${periodo}
        ${raw(reserva.status === 'pendente'
          ? html` &middot; <span class="pill pill--busy">${icone('clock', 'ic ic--sm')}pendente</span>`
          : '')}
      </span>
    </div>`;
}

function renderizarEspacos(): void {
  const corpo = el('tbody-espacos');
  if (!corpo) return;

  const termo = buscaEspacos.trim().toLowerCase();
  const todos = Object.entries(ESTUFAS);
  const linhas = todos.filter(([id, e]) => {
    if (!termo) return true;
    const responsavel = reservaDoEspaco(id)?.pesquisador ?? '';
    return (
      id.toLowerCase().includes(termo)
      || e.nome.toLowerCase().includes(termo)
      || e.tipo.toLowerCase().includes(termo)
      || responsavel.toLowerCase().includes(termo)
    );
  });

  atualizarContador('conta-espacos', linhas.length, todos.length, Boolean(termo));

  if (!linhas.length) {
    corpo.innerHTML = linhaVazia(
      8,
      'warehouse',
      termo ? `Nenhum espaço corresponde a “${buscaEspacos}”.` : 'Nenhum espaço cadastrado.',
    );
    return;
  }

  corpo.innerHTML = juntar(
    linhas.map(([id, e]) => html`
      <tr>
        <td data-label="Código"><span class="code">${id}</span></td>
        <td data-label="Nome" class="table__name">${e.nome}</td>
        <td data-label="Tipo" class="table__muted">
          <span class="table__type">${icone(e.icon, 'ic ic--sm')}${e.tipo}</span>
        </td>
        <td data-label="Área">${e.area}</td>
        <td data-label="Bancadas">${e.cap}</td>
        <td data-label="Status">${statusPill(e.status)}</td>
        <td data-label="Reservado por">${raw(celulaReservadoPor(id))}</td>
        <td data-label="Alterar status">
          <div class="table__actions">
            <select class="select status-select" data-status="${e.status}"
                    data-change="status-espaco" data-id="${id}"
                    aria-label="Alterar status de ${e.nome}">
              ${raw(opcoesStatus(e.status))}
            </select>
          </div>
        </td>
      </tr>
    `),
  );
}

function opcoesStatus(atual: EstufaStatus): string {
  return juntar(
    STATUS_ESPACO.map(
      (status) => html`
        <option value="${status}" ${raw(status === atual ? 'selected' : '')}>
          ${statusInfo(status).label}
        </option>`,
    ),
  );
}

export function alterarStatusEspaco(id: string, status: string): void {
  const estufa = ESTUFAS[id];
  if (!estufa || !STATUS_ESPACO.includes(status as EstufaStatus)) return;

  estufa.status = status as EstufaStatus;
  salvarEstado();
  dadosMudaram();
  aviso(`${estufa.nome}: status alterado para ${statusInfo(status).label.toLowerCase()}.`, 'success');
}

export function buscarEspacos(termo: string): void {
  buscaEspacos = termo;
  show(el('limpar-espacos'), Boolean(termo));
  renderizarEspacos();
}

/* ===========================================================================
   Reservas
   =========================================================================== */

function renderizarReservas(): void {
  const corpo = el('tbody-reservas');
  if (!corpo) return;

  const base = reservasVigentes();
  const pendentes = base.filter((r) => r.status === 'pendente').length;
  atualizarBadgePendentes(pendentes);

  const termo = buscaReservas.trim().toLowerCase();
  const filtrando = Boolean(termo) || filtroReservas !== 'todas';

  const linhas = base
    .filter((r) => filtroReservas === 'todas' || r.status === filtroReservas)
    .filter((r) => {
      if (!termo) return true;
      const nome = ESTUFAS[r.estufaId]?.nome ?? r.estufaId;
      return (
        r.id.toLowerCase().includes(termo)
        || r.projeto.toLowerCase().includes(termo)
        || nome.toLowerCase().includes(termo)
        || (r.pesquisador ?? '').toLowerCase().includes(termo)
      );
    });

  atualizarContador('conta-reservas', linhas.length, base.length, filtrando);

  if (!linhas.length) {
    corpo.innerHTML = linhaVazia(
      7,
      'calendar-x',
      termo
        ? `Nenhuma reserva corresponde a “${buscaReservas}”.`
        : 'Nenhuma reserva neste filtro.',
    );
    return;
  }

  corpo.innerHTML = juntar(
    linhas.map((r) => {
      const nome = ESTUFAS[r.estufaId]?.nome ?? r.estufaId;
      const aprovar = r.status === 'pendente';
      return html`
        <tr class="${raw(aprovar ? 'is-pending' : '')}">
          <td data-label="Código"><span class="code">${r.id}</span></td>
          <td data-label="Espaço" class="table__name">${nome}</td>
          <td data-label="Responsável">
            ${raw(r.pesquisador
              ? html`${r.pesquisador}`
              : html`<span class="table__muted">não informado</span>`)}
          </td>
          <td data-label="Projeto" class="table__truncate" title="${r.projeto}">${r.projeto}</td>
          <td data-label="Período" style="white-space:nowrap">
            ${dataBR(r.data)} a ${dataBR(r.dataFim)}
          </td>
          <td data-label="Status">${statusPill(r.status)}</td>
          <td data-label="Ações">
            <div class="table__actions">
              ${raw(aprovar
                ? html`<button type="button" class="btn btn--primary btn--sm"
                        data-action="aprovar-reserva" data-id="${r.id}">
                        ${icone('check', 'ic ic--sm')}Aprovar
                      </button>`
                : '')}
              <button type="button" class="btn btn--danger btn--sm btn--icon"
                      data-action="cancelar-reserva" data-id="${r.id}"
                      aria-label="Cancelar a reserva ${r.id} de ${nome}">
                ${icone('x', 'ic ic--sm')}
              </button>
            </div>
          </td>
        </tr>`;
    }),
  );
}

function atualizarBadgePendentes(total: number): void {
  for (const id of ['badge-pendentes', 'badge-pendentes-topo']) {
    const badge = el(id);
    if (!badge) continue;
    badge.textContent = String(total);
    show(badge, total > 0);
  }
}

export function aprovarReserva(id: string): void {
  const reserva = reservas.find((r) => r.id === id);
  if (!reserva || reserva.status !== 'pendente') return;

  reserva.status = 'ativa';
  const estufa = ESTUFAS[reserva.estufaId];
  if (estufa) estufa.status = 'ocupada';

  salvarEstado();
  dadosMudaram();
  aviso(`Reserva ${reserva.id} aprovada.`, 'success');
}

export async function cancelarReserva(id: string): Promise<void> {
  const reserva = reservas.find((r) => r.id === id);
  if (!reserva) return;

  const nome = ESTUFAS[reserva.estufaId]?.nome ?? reserva.estufaId;
  const ok = await confirmar({
    titulo: 'Cancelar esta reserva?',
    mensagem: html`
      A reserva <strong>${reserva.id}</strong> de ${nome}, para
      ${dataBR(reserva.data)}, sai da agenda. Não é possível desfazer.`,
    icone: 'calendar-x',
    confirmar: 'Cancelar reserva',
    cancelar: 'Voltar',
    perigo: true,
  });
  if (!ok) return;

  reserva.status = 'cancelada' as ReservaStatus;
  liberarEspacoSeVazio(reserva.estufaId, reserva.id);

  salvarEstado();
  dadosMudaram();
  aviso(`Reserva ${reserva.id} cancelada.`, 'info');
}

export function buscarReservas(termo: string): void {
  buscaReservas = termo;
  show(el('limpar-reservas'), Boolean(termo));
  renderizarReservas();
}

export function filtrarReservas(status: FiltroReserva, botao?: HTMLElement): void {
  filtroReservas = status;
  for (const chip of qsa('[data-action="filtrar-reservas"]')) {
    chip.setAttribute('aria-selected', String(chip === botao || chip.dataset.status === status));
  }
  renderizarReservas();
}

/* ===========================================================================
   Usuários
   =========================================================================== */

function renderizarUsuarios(): void {
  const grade = el('grid-usuarios');
  if (!grade) return;

  const usuarios = listarUsuarios();
  const eu = usuarioAtual();
  setText('conta-usuarios', String(usuarios.length));

  grade.innerHTML = juntar(
    usuarios.map((u) => {
      const admin = u.admin;
      const souEu = eu?.id === u.id;
      // Um admin remove pesquisadores e a própria conta, nunca outro admin.
      const podeExcluir = !admin || souEu;
      return html`
        <div class="user-card" data-role="${admin ? 'admin' : 'pesquisador'}">
          <span class="user-card__avatar">${icone(admin ? 'shield-user' : 'user', 'ic ic--sm')}</span>
          <div class="user-card__body">
            <div class="user-card__name">
              ${u.nome}
              ${raw(souEu ? html`<span class="pill pill--ok">você</span>` : '')}
            </div>
            <div class="user-card__meta">
              ${u.cargo}
              <span class="code">${u.login}</span>
            </div>
          </div>
          ${raw(podeExcluir
            ? html`<button type="button" class="user-card__del"
                    data-action="excluir-usuario" data-id="${u.id}"
                    aria-label="Excluir ${souEu ? 'minha conta' : u.nome}">
                    ${icone('trash-2', 'ic ic--sm')}
                  </button>`
            : '')}
        </div>`;
    }),
  );
}

export function abrirNovoUsuario(): void {
  perfilNovoUsuario = 'pesquisador';

  el<HTMLFormElement>('form-novo-usuario')?.reset();
  const campo = el<HTMLInputElement>('novo-usuario-email');
  campo?.removeAttribute('aria-invalid');
  show(el('novo-usuario-erro'), false);
  marcarPerfilNovoUsuario('pesquisador');

  if (el('modal-usuarios')?.hidden === false) trocarModal('modal-usuarios', 'modal-novo-usuario');
  else abrirModal('modal-novo-usuario');
}

export function definirPerfilNovoUsuario(perfil: PerfilUsuario): void {
  perfilNovoUsuario = perfil;
  marcarPerfilNovoUsuario(perfil);
}

function marcarPerfilNovoUsuario(perfil: PerfilUsuario): void {
  for (const opcao of qsa('#novo-usuario-perfil [data-role]')) {
    const ativo = opcao.dataset.role === perfil;
    opcao.setAttribute('aria-checked', String(ativo));
    opcao.tabIndex = ativo ? 0 : -1;
  }
}

export function confirmarNovoUsuario(): void {
  const campo = el<HTMLInputElement>('novo-usuario-email');
  const resultado = cadastrarUsuario(campo?.value ?? '', perfilNovoUsuario);

  if (!resultado.ok) {
    campo?.setAttribute('aria-invalid', 'true');
    setText('novo-usuario-erro-texto', resultado.erro ?? 'Não foi possível cadastrar.');
    show(el('novo-usuario-erro'), true);
    campo?.focus();
    return;
  }

  campo?.removeAttribute('aria-invalid');
  show(el('novo-usuario-erro'), false);
  renderizarUsuarios();

  trocarModal('modal-novo-usuario', 'modal-usuarios');
  aviso(
    `${resultado.usuario!.nome} cadastrado. Primeiro acesso com o e-mail e a senha ${resultado.senha}.`,
    'success',
  );
}

export async function pedirExclusaoUsuario(
  id: string,
  aoSairDaPropriaConta: () => void,
): Promise<void> {
  const usuario = listarUsuarios().find((u) => u.id === id);
  if (!usuario) return;

  const souEu = usuarioAtual()?.id === id;
  const ok = await confirmar({
    titulo: souEu ? 'Excluir sua conta?' : 'Excluir este usuário?',
    mensagem: souEu
      ? html`A conta <strong>${usuario.nome}</strong> é removida e a sessão
             termina agora. Não é possível desfazer.`
      : html`<strong>${usuario.nome}</strong> perde o acesso ao sistema.
             Não é possível desfazer.`,
    icone: 'user-x',
    confirmar: 'Excluir',
    perigo: true,
  });
  if (!ok) return;

  const resultado = excluirUsuario(id);
  if (!resultado.ok) {
    aviso(resultado.erro ?? 'Não foi possível excluir.', 'error');
    return;
  }

  if (resultado.eraEuMesmo) {
    fecharTodosModais();
    aoSairDaPropriaConta();
    return;
  }

  renderizarUsuarios();
  aviso(`${usuario.nome} foi removido do sistema.`, 'info');
}

/* ===========================================================================
   Navegação interna
   =========================================================================== */

export function irPara(destino: string): void {
  fecharTodosModais();

  if (destino.startsWith('reservas')) {
    const status = destino.split('-')[1] as FiltroReserva | undefined;
    filtrarReservas(status ?? 'todas');
    abrirModal('modal-reservas');
    return;
  }

  const secao = el('sec-espacos');
  if (!secao) return;
  secao.scrollIntoView({ behavior: 'smooth', block: 'start' });
  secao.classList.add('is-flash');
  window.setTimeout(() => secao.classList.remove('is-flash'), 900);
}

export function abrirPainelMetricas(): void {
  renderizarMetricas();
  abrirModal('modal-metricas');
}

export function abrirModalReservas(status?: FiltroReserva): void {
  filtrarReservas(status ?? filtroReservas);
  abrirModal('modal-reservas');
}

export function abrirModalUsuarios(): void {
  renderizarUsuarios();
  abrirModal('modal-usuarios');
}

/* ===========================================================================
   Auxiliares
   =========================================================================== */

function atualizarContador(
  id: string,
  mostrados: number,
  total: number,
  filtrando: boolean,
): void {
  setText(id, filtrando && mostrados !== total ? `${mostrados} de ${total}` : String(total));
}

function linhaVazia(colunas: number, simbolo: string, mensagem: string): string {
  return html`
    <tr class="table__empty">
      <td colspan="${colunas}">
        <div class="empty">
          ${icone(simbolo, 'ic ic--xl')}
          <p class="empty__text">${mensagem}</p>
        </div>
      </td>
    </tr>`;
}

/** Reaplica a busca visível quando a tabela é redesenhada de fora. */
export function limparBusca(qual: 'espacos' | 'reservas'): void {
  const campo = el<HTMLInputElement>(`busca-${qual}`);
  if (campo) {
    campo.value = '';
    campo.focus();
  }
  if (qual === 'espacos') buscarEspacos('');
  else buscarReservas('');
}
