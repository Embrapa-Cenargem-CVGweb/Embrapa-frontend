/**
 * Tipos de domínio do CVGWeb.
 *
 * O formato de reserva acompanha o da API Laravel: período (início e fim),
 * projeto e finalidade.
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
  /** Início do período, AAAA-MM-DD (data_inicio na API). */
  data: string;
  /** Fim do período, AAAA-MM-DD (data_fim na API). */
  dataFim: string;
  /** Código do projeto vinculado. */
  projeto: string;
  /** Para que o espaço será usado. */
  finalidade?: string;
  /** Observações livres. */
  obs?: string;
  /** Nome do funcionário dono da reserva, quando vem da API. */
  pesquisador?: string;
  status: ReservaStatus;
}

/**
 * Usuário da sessão. Mesmo formato nos dois modos: em demonstração vem da
 * lista local, com a API vem do funcionário devolvido em /login.
 */
export interface Usuario {
  id: string;
  nome: string;
  /** Dá acesso à administração (super_usuario na API). */
  admin: boolean;
  /** Cargo mostrado na barra lateral. */
  cargo: string;
  /** Identificação usada para entrar. */
  login: string;
  /** Só no modo demonstração; a API nunca devolve senha. */
  senha?: string;
}

export interface StatusInfo {
  label: string;
  tom: Tom;
  icon: string;
}
