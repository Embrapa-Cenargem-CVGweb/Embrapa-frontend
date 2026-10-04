/**
 * Status e formatação de valores exibidos.
 *
 * O mapa de status é o único lugar que decide rótulo, tom e ícone de cada
 * estado. Nenhum estado é comunicado só por cor: a pill sempre traz ícone
 * mais palavra.
 */
import { html, icone, raw } from './html';
import type { StatusInfo, StatusKey } from '../types';

const STATUS: Record<StatusKey, StatusInfo> = {
  livre: { label: 'Livre', tom: 'ok', icon: 'circle-check' },
  ocupada: { label: 'Ocupada', tom: 'busy', icon: 'user' },
  reservada: { label: 'Reservada', tom: 'booked', icon: 'calendar-check' },
  manutencao: { label: 'Manutenção', tom: 'down', icon: 'wrench' },
  ativa: { label: 'Ativa', tom: 'ok', icon: 'circle-check' },
  pendente: { label: 'Pendente', tom: 'busy', icon: 'clock' },
  cancelada: { label: 'Cancelada', tom: 'down', icon: 'ban' },
};

const DESCONHECIDO: StatusInfo = {
  label: 'Indefinido',
  tom: 'neutral',
  icon: 'circle-question-mark',
};

export function statusInfo(key: string): StatusInfo {
  return STATUS[key as StatusKey] ?? { ...DESCONHECIDO, label: key || 'Indefinido' };
}

/** Pill de status pronta para interpolar com `raw`. */
export function statusPill(key: string): ReturnType<typeof raw> {
  const s = statusInfo(key);
  return raw(
    html`<span class="pill pill--${s.tom}">${icone(s.icon, 'ic ic--sm')}${s.label}</span>`,
  );
}

/** AAAA-MM-DD para DD/MM/AAAA. */
export function dataBR(iso: string): string {
  if (!iso) return '—';
  const [ano, mes, dia] = iso.split('-');
  return dia && mes && ano ? `${dia}/${mes}/${ano}` : iso;
}

/** Data de hoje em AAAA-MM-DD, no fuso local. */
export function hojeISO(): string {
  const agora = new Date();
  const mes = String(agora.getMonth() + 1).padStart(2, '0');
  const dia = String(agora.getDate()).padStart(2, '0');
  return `${agora.getFullYear()}-${mes}-${dia}`;
}

/** Plural simples: 1 bancada / 4 bancadas. */
export function plural(n: number, singular: string, plural_: string): string {
  return `${n} ${n === 1 ? singular : plural_}`;
}
