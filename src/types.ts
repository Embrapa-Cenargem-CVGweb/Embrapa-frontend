/**
 * Tipos de domínio do CVGWeb.
 *
 * O formato acompanha o da API Laravel. Duas noções diferentes de "status" de
 * espaço convivem aqui, e misturá-las foi fonte de bug:
 *
 * - `EstufaSituacao` é o que está gravado no banco e o administrador controla:
 *   ATIVA, RESERVADA, OCUPADA, MANUTENCAO ou INATIVA. RESERVADA e OCUPADA são
 *   bloqueios manuais — a administração segura o espaço sem precisar criar uma
 *   reserva no sistema.
 * - `EstufaStatus` é **derivado** da ocupação do dia e ninguém define à mão:
 *   livre, parcial (parte da capacidade tomada) ou ocupada (capacidade cheia).
 *   Espaço com situação diferente de ATIVA mostra a própria situação.
 */

/** Situação cadastral do espaço — é isto que grava no banco. */
export type EstufaSituacao = 'ATIVA' | 'RESERVADA' | 'OCUPADA' | 'MANUTENCAO' | 'INATIVA';

/** Situação visível do espaço, calculada a partir da ocupação. */
export type EstufaStatus =
  | 'livre'
  | 'parcial'
  | 'ocupada'
  | 'reservada'
  | 'manutencao'
  | 'inativa';

export type ReservaStatus = 'ativa' | 'pendente' | 'cancelada';

/** Chave aceita pelo mapa de status: de espaço ou de reserva. */
export type StatusKey = EstufaStatus | ReservaStatus;

/** Tom visual de um status. Casa com os tokens --ok / --busy / --booked / --down. */
export type Tom = 'ok' | 'busy' | 'booked' | 'down' | 'neutral';


/** Unidade em que a capacidade do espaço é contada. */
export type UnidadeCapacidade = 'VASO' | 'BANCADA';

/** Capacidade aproximada de vasos, por diâmetro. Informativo. */
export interface VasosCapacidade {
  c3: number;
  c5: number;
  c10: number;
}

export interface Estufa {
  /** Código real do cadastro (CVG01). A chave do mapa é a posição (E01). */
  codigo: string;
  nome: string;
  tipo: string;
  setor?: string;
  /** Derivado da ocupação — não é o que se grava. */
  status: EstufaStatus;
  /** O que está no banco e o administrador altera. */
  situacao: EstufaSituacao;
  area: string;
  /** Número de bancadas do espaço. Informativo. */
  cap: number;
  /** Unidade da capacidade reservável. */
  unidade: UnidadeCapacidade;
  /** Capacidade reservável total. */
  capacidadeTotal: number;
  /** Quanto está tomado hoje. */
  ocupado: number;
  /** Quanto sobra hoje. */
  disponivel: number;
  /** Nome do símbolo no sprite, sem o prefixo `i-`. */
  icon: string;
  desc: string;
  vasos?: VasosCapacidade;
}

/** Espaços indexados pela posição no mapa (E01, E02, ...). */
export type Estufas = Record<string, Estufa>;

export interface Reserva {
  id: string;
  estufaId: string;
  /** Início do período, AAAA-MM-DD (data_inicio na API). */
  data: string;
  /** Fim do período, AAAA-MM-DD (data_fim na API). */
  dataFim: string;
  /** Quantas unidades (vasos ou bancadas) esta reserva toma. */
  quantidade: number;
  /** Código do projeto vinculado. */
  projeto: string;
  /** Título do projeto, quando a API o devolve junto. */
  projetoTitulo?: string;
  /** Para que o espaço será usado. */
  finalidade?: string;
  /** Observações livres. */
  obs?: string;
  /** Nome do funcionário dono da reserva, quando vem da API. */
  pesquisador?: string;
  status: ReservaStatus;
}

/** Situação do acesso de um usuário, como a API devolve. */
export type SituacaoUsuario = 'ATIVO' | 'CONVITE_PENDENTE' | 'INATIVO';

/** Estado do convite de primeiro acesso, como a API resume. */
export interface ConviteDoUsuario {
  /** ENVIADO, NAO_ENVIADO (o e-mail não saiu), VENCIDO ou SEM_CONVITE. */
  estado: 'ENVIADO' | 'NAO_ENVIADO' | 'VENCIDO' | 'SEM_CONVITE';
  mensagem: string;
  erro_codigo?: string | null;
}

/** Usuário da sessão, montado a partir do funcionário devolvido em /login. */
export interface Usuario {
  id: string;
  nome: string;
  /** Dá acesso à administração (super_usuario na API). */
  admin: boolean;
  /** Cargo mostrado na barra lateral. */
  cargo: string;
  /** E-mail institucional: é com ele que a pessoa entra. */
  email?: string;
  /** Identificador interno (coluna `matricula` na API), quando cadastrado. */
  matricula?: string;
  /** Id do cargo, para o formulário de edição pré-selecionar. */
  cargoId?: number;
  /** Em quantos projetos a pessoa esta na equipe. */
  projetos?: number;
  /** Ultimo acesso, como a API devolve (AAAA-MM-DD HH:MM:SS). */
  ultimoAcesso?: string;
  /** Situação do acesso; sem senha criada fica CONVITE_PENDENTE. */
  situacao?: SituacaoUsuario;
  /** Como está o convite de quem ainda não criou a senha. */
  convite?: ConviteDoUsuario | null;
}

export interface StatusInfo {
  label: string;
  tom: Tom;
  icon: string;
}

/**
 * Disponibilidade de um espaço num período, como a API responde em
 * `/casas-vegetacao/{id}/disponibilidade`.
 */
export interface Disponibilidade {
  capacidade_total: number;
  ocupado: number;
  disponivel: number;
  unidade: UnidadeCapacidade;
  aceita_reserva: boolean;
  mensagem: string;
  cabe?: boolean;
  faltam?: number;
  ocupantes: {
    funcionario?: string;
    projeto?: string;
    quantidade: number;
    data_inicio: string;
    data_fim: string;
    status: string;
  }[];
}
