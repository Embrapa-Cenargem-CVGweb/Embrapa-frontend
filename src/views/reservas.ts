/**
 * Reservar um espaço e consultar uma reserva.
 *
 * A reserva é um período (início e fim) vinculado a um projeto, no mesmo
 * formato que a API Laravel espera.
 */
import {
  ESTUFAS,
  proximoIdReserva,
  reservas,
  salvarEstado,
} from '../data/estufas';
import { dadosMudaram } from '../lib/bus';
import { el, setText, show } from '../lib/dom';
import { html, icone } from '../lib/html';
import { dataBR, hojeISO, plural, statusPill } from '../lib/format';
import { abrirModal, fecharModal, fecharTodosModais } from '../lib/modal';
import { aviso } from '../lib/toast';
import { fecharPainel } from './mapa';
import { usuarioAtual } from './login';

/** Espaço que o modal de reserva está preenchendo. */
let espacoDaReserva: string | null = null;
/** Reserva aberta no modal de consulta. */
let reservaAberta: string | null = null;

function valor(id: string): string {
  return (el<HTMLInputElement>(id)?.value ?? '').trim();
}

/* ===========================================================================
   Reservar
   =========================================================================== */

export function abrirModalReservar(estufaId: string): void {
  const estufa = ESTUFAS[estufaId];
  if (!estufa) return;

  if (estufa.status !== 'livre') {
    aviso('Este espaço não está disponível.', 'error');
    return;
  }

  espacoDaReserva = estufaId;

  setText('reservar-titulo', `Reservar ${estufa.nome}`);
  setText('reservar-descricao', estufa.desc || estufa.tipo);
  setText('reservar-area', estufa.area);
  setText('reservar-bancadas', plural(estufa.cap, 'bancada', 'bancadas'));

  const status = el('reservar-status');
  if (status) status.innerHTML = html`${statusPill(estufa.status)}`;

  const marca = el('reservar-marca');
  if (marca) marca.innerHTML = html`${icone(estufa.icon)}`;

  el<HTMLFormElement>('form-reservar')?.reset();

  // O período não pode começar no passado.
  const hoje = hojeISO();
  const inicio = el<HTMLInputElement>('reservar-data-inicio');
  const fim = el<HTMLInputElement>('reservar-data-fim');
  if (inicio) {
    inicio.min = hoje;
    inicio.removeAttribute('aria-invalid');
  }
  if (fim) {
    fim.min = hoje;
    fim.removeAttribute('aria-invalid');
  }

  fecharPainel();
  abrirModal('modal-reservar');
}

/** O fim do período acompanha o início, para não ficar para trás dele. */
export function ajustarFimDoPeriodo(): void {
  const inicio = el<HTMLInputElement>('reservar-data-inicio');
  const fim = el<HTMLInputElement>('reservar-data-fim');
  if (!inicio || !fim) return;

  if (inicio.value) fim.min = inicio.value;
  if (fim.value && inicio.value && fim.value < inicio.value) fim.value = inicio.value;
}

export function confirmarReserva(): void {
  if (!espacoDaReserva) return;
  const estufa = ESTUFAS[espacoDaReserva];
  if (!estufa) return;

  const inicio = valor('reservar-data-inicio');
  const fim = valor('reservar-data-fim');
  const projeto = valor('reservar-projeto');
  const finalidade = valor('reservar-finalidade');
  const obs = valor('reservar-obs');

  if (!inicio || !fim || !projeto || !finalidade) {
    aviso('Preencha o período, o projeto e a finalidade.', 'error');
    return;
  }

  const campoFim = el<HTMLInputElement>('reservar-data-fim');
  if (fim < inicio) {
    campoFim?.setAttribute('aria-invalid', 'true');
    campoFim?.focus();
    aviso('O fim do período não pode ser antes do início.', 'error');
    return;
  }
  campoFim?.removeAttribute('aria-invalid');

  reservas.push({
    id: proximoIdReserva(),
    estufaId: espacoDaReserva,
    data: inicio,
    dataFim: fim,
    projeto,
    finalidade,
    obs,
    // Quem está na sessão é o dono da reserva; com a API o back-end faz o
    // mesmo a partir do token.
    pesquisador: usuarioAtual()?.nome ?? '',
    status: 'pendente',
  });

  estufa.status = 'reservada';
  salvarEstado();
  dadosMudaram();

  fecharModal(el('modal-reservar'));
  espacoDaReserva = null;
  aviso(`${estufa.nome} reservada. A reserva entra como pendente de aprovação.`, 'success');
}

/* ===========================================================================
   Consultar
   =========================================================================== */

export function verReserva(id: string): void {
  const reserva = reservas.find((r) => r.id === id);
  if (!reserva) return;

  const estufa = ESTUFAS[reserva.estufaId];
  reservaAberta = id;

  setText('ver-reserva-titulo', estufa ? estufa.nome : reserva.estufaId);
  setText('ver-reserva-descricao', estufa?.tipo ?? 'Espaço não encontrado');
  setText('ver-reserva-codigo', reserva.id);
  setText('ver-reserva-inicio', dataBR(reserva.data));
  setText('ver-reserva-fim', dataBR(reserva.dataFim));
  setText('ver-reserva-projeto', reserva.projeto);
  setText('ver-reserva-finalidade', reserva.finalidade || '—');
  setText('ver-reserva-pesquisador', reserva.pesquisador || '—');

  const status = el('ver-reserva-status');
  if (status) status.innerHTML = html`${statusPill(reserva.status)}`;

  // Reserva já cancelada não oferece o botão de cancelar.
  show(el('ver-reserva-cancelar'), reserva.status !== 'cancelada');

  fecharPainel();
  abrirModal('modal-ver-reserva');
}

export function cancelarReservaAberta(): void {
  const reserva = reservas.find((r) => r.id === reservaAberta);
  if (!reserva || reserva.status === 'cancelada') {
    fecharTodosModais();
    return;
  }

  reserva.status = 'cancelada';
  liberarEspacoSeVazio(reserva.estufaId, reserva.id);

  salvarEstado();
  dadosMudaram();
  fecharTodosModais();
  reservaAberta = null;
  aviso(`Reserva ${reserva.id} cancelada.`, 'info');
}

/**
 * Devolve o espaço para livre, mas só quando não sobrou nenhuma outra reserva
 * vigente nele.
 */
export function liberarEspacoSeVazio(estufaId: string, exceto: string): void {
  const estufa = ESTUFAS[estufaId];
  if (!estufa) return;

  const outras = reservas.some(
    (r) => r.estufaId === estufaId && r.id !== exceto && r.status !== 'cancelada',
  );
  if (!outras) estufa.status = 'livre';
}
