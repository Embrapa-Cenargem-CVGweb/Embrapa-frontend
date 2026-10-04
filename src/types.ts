/**
 * Tipos de domínio do CVGWeb.
 */

export type EstufaStatus = 'livre' | 'ocupada' | 'reservada' | 'manutencao';

export type ReservaStatus = 'ativa' | 'pendente' | 'cancelada';

/** Chave aceita pelo mapa de status: de espaço ou de reserva. */
export type StatusKey = EstufaStatus | ReservaStatus;

/** Tom visual de um status. Casa com os tokens --ok / --busy / --booked / --down. */
export type Tom = 'ok' | 'busy' | 'booked' | 'down' | 'neutral';

export type PerfilUsuario = 'admin' | 'pesquisador';

/** Capacidade aproximada de vasos, por diâmetro. */
export interface VasosCapacidade {
  c3: number;
  c5: number;
  c10: number;
}

export interface Estufa {
  nome: string;
  tipo: string;
  setor?: string;
  status: EstufaStatus;
  area: string;
  /** Número de bancadas disponíveis. */
  cap: number;
  /** Nome do símbolo no sprite, sem o prefixo `i-`. */
  icon: string;
  desc: string;
  vasos?: VasosCapacidade;
}

/** Espaços indexados pelo código (E01, E02, ...). */
export type Estufas = Record<string, Estufa>;

export interface Reserva {
  id: string;
  estufaId: string;
  /** Data no formato AAAA-MM-DD. */
  data: string;
  qtd: number;
  projeto: string;
  status: ReservaStatus;
}

export interface Usuario {
  id: string;
  name: string;
  role: PerfilUsuario;
  login: string;
  senha: string;
}

export interface StatusInfo {
  label: string;
  tom: Tom;
  icon: string;
}
