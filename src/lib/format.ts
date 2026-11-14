/**
 * Status e formatação de valores exibidos.
 *
 * O mapa de status é o único lugar que decide rótulo, tom e ícone de cada
 * estado. Nenhum estado é comunicado só por cor: a pill sempre traz ícone
 * mais palavra.
 */
import { html, icone, raw } from './html';
import type { StatusInfo, StatusKey, UnidadeCapacidade } from '../types';

const STATUS: Record<StatusKey, StatusInfo> = {
  livre: { label: 'Livre', tom: 'ok', icon: 'circle-check' },
  // Parte da capacidade tomada: ainda dá para reservar o que sobrou.
  parcial: { label: 'Parcial', tom: 'booked', icon: 'calendar-check' },
  ocupada: { label: 'Ocupada', tom: 'busy', icon: 'user' },
  // Lotada com pedido ainda esperando aprovação (ou bloqueio da administração).
  reservada: { label: 'Reservada', tom: 'booked', icon: 'calendar-check' },
  manutencao: { label: 'Manutenção', tom: 'down', icon: 'wrench' },
  inativa: { label: 'Inativa', tom: 'neutral', icon: 'ban' },
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

/**
 * AAAA-MM-DD para DD/MM/AAAA. Aceita também data com hora
 * ("2026-11-10T03:00:00.000000Z"): usa só a parte da data, em vez de colar
 * a hora no dia ("10T03:00:00.000000Z/11/2026").
 */
export function dataBR(iso: string): string {
  if (!iso) return '—';
  const [ano, mes, dia] = iso.slice(0, 10).split('-');
  return dia && mes && ano ? `${dia}/${mes}/${ano}` : iso;
}

/** Fuso em que o sistema mostra as horas: o do Cenargen. */
const FUSO = 'America/Sao_Paulo';

const NO_FUSO = new Intl.DateTimeFormat('pt-BR', {
  timeZone: FUSO,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/**
 * "2026-11-06 13:11:02" (ou com T) para "06/11/2026 13:11".
 *
 * Quando a data vem com fuso ("2026-11-12T21:53:00.000000Z", o padrão do
 * Laravel ao serializar datas de model), ela é convertida para o horário de
 * Brasília. Antes o "Z" era ignorado e os Logs mostravam a hora em UTC,
 * três horas adiantada.
 */
export function dataHoraBR(iso: string): string {
  if (!iso) return '—';

  if (/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(iso.trim())) {
    const quando = new Date(iso);
    if (!Number.isNaN(quando.getTime())) {
      const p = Object.fromEntries(NO_FUSO.formatToParts(quando).map((x) => [x.type, x.value]));
      return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
    }
  }

  const [data = '', hora = ''] = iso.replace('T', ' ').split(' ');
  const minutos = hora.slice(0, 5);

  return minutos ? `${dataBR(data)} ${minutos}` : dataBR(data);
}

/** Data de hoje em AAAA-MM-DD, no fuso local. */
export function hojeISO(): string {
  const agora = new Date();
  const mes = String(agora.getMonth() + 1).padStart(2, '0');
  const dia = String(agora.getDate()).padStart(2, '0');
  return `${agora.getFullYear()}-${mes}-${dia}`;
}

/** Número com vírgula e sem zero sobrando: 22.5 -> "22,5", 28 -> "28". */
function numeroBR(n: number): string {
  return String(Math.round(n * 10) / 10).replace('.', ',');
}

/**
 * Temperatura da estufa em uma frase curta: "22 a 28 °C", "25 °C" (mínima e
 * máxima iguais), "a partir de 22 °C", "até 28 °C" ou "—" quando ninguém
 * informou.
 */
export function temperaturaTexto(min: number | null | undefined, max: number | null | undefined): string {
  const temMin = typeof min === 'number';
  const temMax = typeof max === 'number';
  if (temMin && temMax) return min === max ? `${numeroBR(min)} °C` : `${numeroBR(min)} a ${numeroBR(max)} °C`;
  if (temMin) return `a partir de ${numeroBR(min)} °C`;
  if (temMax) return `até ${numeroBR(max)} °C`;
  return '—';
}

/** "5 de 3 cm · 2 de 20 cm" — os vasos da estufa, por tamanho. Vazio sem lista. */
export function vasosTexto(vasos: { tamanho_cm: number; quantidade: number }[] | undefined): string {
  return (vasos ?? []).map((v) => `${v.quantidade} de ${numeroBR(v.tamanho_cm)} cm`).join(' · ');
}

/** Plural simples: 1 bancada / 4 bancadas. */
export function plural(n: number, singular: string, plural_: string): string {
  return `${n} ${n === 1 ? singular : plural_}`;
}

/** "10 vasos" / "1 bancada", concordando com a unidade do espaço. */
export function capacidade(n: number, unidade: UnidadeCapacidade): string {
  return unidade === 'VASO' ? plural(n, 'vaso', 'vasos') : plural(n, 'bancada', 'bancadas');
}

/**
 * "10 vasos livres" — o que a tabela e a ficha mostram. Antes era "10 de 20
 * vasos livres": o "de 20" confundia sobre o que ainda dá para usar.
 */
export function ocupacaoResumo(
  disponivel: number,
  _total: number,
  unidade: UnidadeCapacidade,
): string {
  return `${capacidade(disponivel, unidade)} ${disponivel === 1 ? 'livre' : 'livres'}`;
}
