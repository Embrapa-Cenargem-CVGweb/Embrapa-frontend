/**
 * Reservar um espaço e consultar uma reserva.
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

/** Espaço que o modal de reserva está preenchendo. */
let espacoDaReserva: string | null = null;
/** Reserva aberta no modal de consulta. */
let reservaAberta: string | null = null;

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

  const formulario = el<HTMLFormElement>('form-reservar');
  formulario?.reset();

  const data = el<HTMLInputElement>('reservar-data');
  if (data) data.min = hojeISO();

  const qtd = el<HTMLInputElement>('reservar-qtd');
  if (qtd) {
    qtd.max = String(estufa.cap);
    qtd.removeAttribute('aria-invalid');
  }
  setText('reservar-limite', `Até ${estufa.cap} por reserva`);

  fecharPainel();
  abrirModal('modal-reservar');
}

export function confirmarReserva(): void {
  if (!espacoDaReserva) return;
  const estufa = ESTUFAS[espacoDaReserva];
  if (!estufa) return;

  const data = el<HTMLInputElement>('reservar-data')?.value ?? '';
  const qtdCampo = el<HTMLInputElement>('reservar-qtd');
  const qtd = Number(qtdCampo?.value ?? '');
  const projeto = el<HTMLSelectElement>('reservar-projeto')?.value ?? '';

  if (!data || !qtdCampo?.value || !projeto) {
    aviso('Preencha data, quantidade e projeto.', 'error');
    return;
  }

  if (!Number.isInteger(qtd) || qtd < 1) {
    qtdCampo.setAttribute('aria-invalid', 'true');
    qtdCampo.focus();
    aviso('A quantidade precisa ser um número inteiro de 1 para cima.', 'error');
    return;
  }

  if (qtd > estufa.cap) {
    qtdCampo.setAttribute('aria-invalid', 'true');
    qtdCampo.focus();
    aviso(`${estufa.nome} comporta até ${estufa.cap} por reserva.`, 'error');
    return;
  }

  qtdCampo.removeAttribute('aria-invalid');

  reservas.push({
    id: proximoIdReserva(),
    estufaId: espacoDaReserva,
    data,
    qtd,
    projeto,
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
  setText('ver-reserva-data', dataBR(reserva.data));
  setText('ver-reserva-qtd', plural(reserva.qtd, 'vaso ou estante', 'vasos ou estantes'));
  setText('ver-reserva-projeto', reserva.projeto);

  const status = el('ver-reserva-status');
  if (status) status.innerHTML = html`${statusPill(reserva.status)}`;

  // Reserva já cancelada não oferece o botão de cancelar.
  const cancelar = el('ver-reserva-cancelar');
  show(cancelar, reserva.status !== 'cancelada');

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
