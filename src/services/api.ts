/**
 * Acesso à API Laravel do CVGWeb.
 *
 * `VITE_API_URL` é obrigatória: sem ela não há de onde ler nem para onde
 * gravar, e o app não tem fonte local nenhuma.
 *
 * Toda escrita passa por aqui — antes o front só sabia ler, e reserva,
 * aprovação, cancelamento e cadastro de usuário morriam no localStorage.
 * O token agora usa sessionStorage: expira ao fechar o navegador.
 *
 * Erro de validação do Laravel (422) vem como `{ message, errors: { campo:
 * [...] } }`. `mensagemDoErro` desembrulha isso para a frase que o back-end
 * escreveu — é ela que diz, por exemplo, quantos vasos sobraram e com quem
 * está o resto.
 */
import type { Disponibilidade, EstufaSituacao } from '../types';

const API_URL = import.meta.env.VITE_API_URL;

const CHAVE_TOKEN = 'cvgweb:token';

export function tokenSalvo(): string | null {
  try {
    return sessionStorage.getItem(CHAVE_TOKEN);
  } catch {
    return null;
  }
}

export function guardarToken(token: string): void {
  try {
    sessionStorage.setItem(CHAVE_TOKEN, token);
  } catch {
    /* storage indisponível */
  }
}

export function descartarToken(): void {
  try {
    sessionStorage.removeItem(CHAVE_TOKEN);
  } catch {
    /* storage indisponível */
  }
}

function cabecalhos(comCorpo = false): HeadersInit {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (comCorpo) headers['Content-Type'] = 'application/json';
  const token = tokenSalvo();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/** A frase mais útil que a resposta de erro carrega. */
function mensagemDoErro(dados: unknown, padrao: string): string {
  if (!dados || typeof dados !== 'object') return padrao;

  const corpo = dados as { message?: string; errors?: Record<string, string[]> };

  // Erros de campo primeiro: são os que explicam o motivo (capacidade, período).
  const primeiro = corpo.errors && Object.values(corpo.errors)[0]?.[0];
  if (primeiro) return primeiro;

  return corpo.message || padrao;
}

/**
 * Erro vindo da API, com o código HTTP à mão.
 *
 * Era um `Error` cru: a tela recebia a frase e não tinha como distinguir
 * "sem permissão" de "servidor caiu" de "não encontrei", que pedem respostas
 * diferentes. Quem só quer a mensagem continua usando `erro.message`.
 */
export class ErroApi extends Error {
  constructor(
    mensagem: string,
    readonly status: number,
    readonly corpo: unknown = null,
  ) {
    super(mensagem);
    this.name = 'ErroApi';
  }
}

/** Frase única para sessão morta, usada no erro e na tela de entrada. */
const SESSAO_MORTA = 'Sua sessão expirou. Entre novamente.';

type AoPerderSessao = (mensagem: string) => void;

let aoPerderSessaoOuvinte: AoPerderSessao | null = null;

/**
 * Avisa quem precisa reagir a um token morto.
 *
 * Qualquer chamada pode receber 401 no meio da sessão — token expirado, acesso
 * desativado pela administração, banco recriado. Antes a tela mostrava o aviso
 * e seguia exibindo dados velhos com um token que não vale mais, e a próxima
 * ação falhava de novo. Agora a sessão é descartada no mesmo instante e a
 * casca da aplicação devolve a pessoa para a entrada.
 */
export function aoPerderSessao(ouvinte: AoPerderSessao): void {
  aoPerderSessaoOuvinte = ouvinte;
}

/** 401/419: o token morreu. Descarta e avisa antes de o erro subir. */
function conferirSessao(status: number): void {
  if (status !== 401 && status !== 419) return;

  descartarToken();
  aoPerderSessaoOuvinte?.(SESSAO_MORTA);
}

function erroDaResposta(status: number, dados: unknown, padrao: string): ErroApi {
  if (status === 401 || status === 419) {
    return new ErroApi(SESSAO_MORTA, status, dados);
  }

  return new ErroApi(mensagemDoErro(dados, padrao), status, dados);
}

async function buscar<T>(caminho: string, oQue: string): Promise<T> {
  const resposta = await fetch(`${API_URL}${caminho}`, { headers: cabecalhos() });

  if (!resposta.ok) {
    const dados = await resposta.json().catch(() => null);
    conferirSessao(resposta.status);
    throw erroDaResposta(resposta.status, dados, `Falha ao buscar ${oQue} (HTTP ${resposta.status})`);
  }

  return resposta.json() as Promise<T>;
}

async function enviar<T>(
  metodo: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  caminho: string,
  corpo?: unknown,
  padrao = 'Não foi possível concluir a operação.',
): Promise<T> {
  const resposta = await fetch(`${API_URL}${caminho}`, {
    method: metodo,
    headers: cabecalhos(corpo !== undefined),
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });

  const dados = await resposta.json().catch(() => null);

  if (!resposta.ok) {
    conferirSessao(resposta.status);
    throw erroDaResposta(resposta.status, dados, padrao);
  }

  return dados as T;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/* ===========================================================================
   Leitura
   =========================================================================== */

export function getCasasVegetacao(): Promise<any> {
  return buscar('/casas-vegetacao?per_page=200&com_ocupacao=1', 'as casas de vegetação');
}

export function getReservas(): Promise<any> {
  return buscar('/reservas?status=TODAS&per_page=500', 'as reservas');
}

/** Métricas do painel da administração, calculadas no back-end. */
export function getPainel(): Promise<any> {
  return buscar('/painel', 'as métricas do painel');
}

export interface CargoApi {
  id: number;
  nome: string;
}

/** Pessoa que pode ser escolhida como participante de projeto. */
export interface PessoaOpcao {
  id: number;
  nome: string;
  cargo: string | null;
}

/** Pessoas ativas (nome e cargo), para escolher participantes de projeto. */
export function getPessoasOpcoes(): Promise<PessoaOpcao[]> {
  return buscar('/funcionarios/opcoes', 'as pessoas');
}

/** Cargos cadastrados, para o formulário de usuário. */
export function getCargos(): Promise<CargoApi[]> {
  return buscar('/cargos', 'os cargos');
}

export function getFuncionarios(): Promise<any> {
  return buscar('/funcionarios?per_page=200', 'os usuários');
}

/**
 * Quanto sobra num espaço no período, e se a quantidade pedida cabe.
 * `ignorarReserva` exclui da conta uma reserva que está sendo editada.
 */
export function getDisponibilidade(
  casaId: number,
  opcoes: { de: string; ate: string; quantidade?: number; ignorarReserva?: number },
): Promise<Disponibilidade> {
  const busca = new URLSearchParams({ de: opcoes.de, ate: opcoes.ate });
  if (opcoes.quantidade) busca.set('quantidade', String(opcoes.quantidade));
  if (opcoes.ignorarReserva) busca.set('ignorar_reserva', String(opcoes.ignorarReserva));

  return buscar(`/casas-vegetacao/${casaId}/disponibilidade?${busca}`, 'a disponibilidade do espaço');
}

/* ===========================================================================
   Reservas
   =========================================================================== */

export interface NovaReserva {
  casa_vegetacao_id: number;
  quantidade: number;
  data_inicio: string;
  data_fim: string;
  finalidade: string;
  projeto_id?: number | null;
  obs?: string;
}

/**
 * Cria a reserva. Quem não tem permissão de aprovar recebe a reserva como
 * PENDENTE — é o back-end que decide, não o front.
 */
export function criarReserva(reserva: NovaReserva): Promise<any> {
  return enviar('POST', '/reservas', reserva, 'Não foi possível registrar a reserva.');
}

export function aprovarReserva(id: number): Promise<any> {
  return enviar('POST', `/reservas/${id}/aprovar`, undefined, 'Não foi possível aprovar a reserva.');
}

/**
 * Campos editáveis de uma reserva.
 *
 * Mexer em período ou quantidade devolve a reserva para PENDENTE: o back-end
 * decide isso e diz na mensagem da resposta.
 */
export interface EdicaoReserva {
  data_inicio?: string;
  data_fim?: string;
  quantidade?: number;
  projeto_id?: number;
  finalidade?: string;
  obs?: string | null;
}

export function atualizarReserva(id: number, dados: EdicaoReserva): Promise<any> {
  return enviar('PUT', `/reservas/${id}`, dados, 'Não foi possível salvar a reserva.');
}

export function excluirReserva(id: number): Promise<any> {
  return enviar('DELETE', `/reservas/${id}`, undefined, 'Não foi possível excluir a reserva.');
}

export function cancelarReserva(id: number, motivo?: string): Promise<any> {
  return enviar(
    'POST',
    `/reservas/${id}/cancelar`,
    motivo ? { motivo } : {},
    'Não foi possível cancelar a reserva.',
  );
}

/* ===========================================================================
   Espaços
   =========================================================================== */

export interface DadosEspaco {
  codigo: string;
  descricao: string;
  tipo?: string;
  localizacao?: string;
  area_m2?: number | null;
  /** Número de bancadas — informativo. */
  capacidade?: number | null;
  unidade_capacidade: 'VASO' | 'BANCADA';
  /** Capacidade reservável: é esta que a reserva consome. */
  capacidade_total: number;
  obs?: string | null;
  status?: EstufaSituacao;
}

/**
 * Sugestões para os campos de texto livre do cadastro: tipos e setores que já
 * existem, mais os tipos previstos em config/cvgweb.php. A lista vive no
 * back-end de propósito — aqui ela só alimenta o datalist.
 */
export function getTiposEspaco(): Promise<any> {
  return buscar('/casas-vegetacao/tipos', 'os tipos de espaço');
}

export function criarEspaco(dados: DadosEspaco): Promise<any> {
  return enviar('POST', '/casas-vegetacao', dados, 'Não foi possível cadastrar o espaço.');
}

/**
 * Altera o cadastro do espaço. O back-end recusa reduzir a capacidade abaixo
 * do que já está reservado — a mensagem dele diz quanto está em uso.
 */
export function atualizarEspaco(casaId: number, dados: DadosEspaco): Promise<any> {
  return enviar('PUT', `/casas-vegetacao/${casaId}`, dados, 'Não foi possível salvar o espaço.');
}

/**
 * Grava a situação cadastral: ATIVA, RESERVADA, OCUPADA, MANUTENCAO ou
 * INATIVA. Só ATIVA aceita reserva nova; o back-end recusa as outras com o
 * motivo. Livre e parcial continuam sendo cálculo da ocupação, não escolha.
 */
export function atualizarSituacaoEspaco(casaId: number, status: EstufaSituacao): Promise<any> {
  return enviar(
    'PATCH',
    `/casas-vegetacao/${casaId}/situacao`,
    { status },
    'Não foi possível alterar a situação do espaço.',
  );
}

/* ===========================================================================
   Usuários
   =========================================================================== */

export interface NovoFuncionario {
  nome: string;
  /** Único identificador de entrada: não há mais usuário/nick. */
  email: string;
  /** Identificador interno (coluna `matricula` no banco). */
  matricula?: string;
  /**
   * Obrigatório. Também decide o acesso: o cargo Administrador vira adm do
   * sistema (perfil `/SU/`, montado no back-end); os demais, funcionário comum.
   */
  cargo_id: number;
}

/**
 * Cadastra o usuário. O back-end manda o e-mail com o link de criação de
 * senha; nenhuma senha trafega por aqui.
 */
export function criarFuncionario(dados: NovoFuncionario): Promise<any> {
  return enviar('POST', '/funcionarios', dados, 'Não foi possível cadastrar o usuário.');
}

/**
 * Campos editáveis de um funcionário. Todos opcionais: o back-end valida com
 * `sometimes`, então o que não for enviado fica como está.
 */
export interface DadosFuncionario {
  nome?: string;
  email?: string;
  matricula?: string | null;
  /** Dar ou tirar o cargo Administrador é só do adm (o back-end recusa os demais). */
  cargo_id?: number;
}

export function atualizarFuncionario(id: number, dados: DadosFuncionario): Promise<any> {
  return enviar('PUT', `/funcionarios/${id}`, dados, 'Não foi possível salvar o usuário.');
}

/**
 * Ativa ou desativa o acesso, preservando o histórico. Desativar quem lidera
 * projetos exige `novosLideres` (projeto → quem assume): a API recusa sem.
 */
export function atualizarSituacaoFuncionario(
  id: number,
  ativo: boolean,
  novosLideres?: Record<number, number>,
): Promise<any> {
  return enviar(
    'PATCH',
    `/funcionarios/${id}/situacao`,
    novosLideres ? { ativo, novos_lideres: novosLideres } : { ativo },
    'Não foi possível alterar a situação do acesso.',
  );
}

/** Projeto que a pessoa lidera, com quem da equipe pode assumir. */
export interface ProjetoLiderado {
  id: number;
  codigo: string;
  titulo: string;
  equipe: { id: number; nome: string; cargo: string | null }[];
}

export function getLideranca(id: number): Promise<ProjetoLiderado[]> {
  return buscar(`/funcionarios/${id}/lideranca`, 'os projetos que a pessoa lidera');
}

/**
 * O que a API conta sobre o envio do link de acesso. `enviado` falso não é
 * erro da chamada: o link foi gerado, só o e-mail é que não saiu — e nesse
 * caso `link` vem junto para o administrador entregar por outro canal.
 */
export interface EnvioDoConvite {
  enviado: boolean;
  simulado?: boolean;
  codigo?: string | null;
  mensagem?: string;
  link?: string;
  enviado_para?: string;
  pode_tentar_de_novo?: boolean;
}

/** Como está o envio de e-mail do servidor (aviso da tela de usuários). */
export interface SituacaoDoEmail {
  mailer: string;
  remetente: string | null;
  pronto: boolean;
  avisos: string[];
}

export function getSituacaoDoEmail(): Promise<SituacaoDoEmail> {
  return buscar('/acesso/email', 'a situação do envio de e-mail');
}

export function reenviarConvite(id: number): Promise<any> {
  return enviar('POST', `/funcionarios/${id}/convite`, undefined, 'Não foi possível enviar o convite.');
}

/* ===========================================================================
   Projetos, equipe e permissões

   Quem configura equipe e permissões é o administrador. Um membro só faz, no
   próprio projeto, o que o adm concedeu — sem concessão, o CRUD é só do adm.
   =========================================================================== */

/** Chave de permissão concedida pelo adm dentro de um projeto. */
export type PermissaoProjeto =
  | 'projeto.editar'
  | 'equipe.adicionar'
  | 'equipe.editar'
  | 'equipe.remover'
  | 'funcionario.criar'
  | 'funcionario.editar'
  | 'reserva.criar'
  | 'reserva.editar'
  | 'reserva.cancelar'
  | 'reserva.aprovar'
  | 'reserva.excluir'
  | 'casa.configurar'
  | 'auditoria.ver';

export type PapelEquipe = 'LIDER' | 'PESQUISADOR';

export interface MembroEquipe {
  id: number;
  nome: string;
  email?: string;
  cargo?: string;
  ativo: boolean;
  funcao?: string | null;
  papel: PapelEquipe | null;
  lider: boolean;
  permissoes: PermissaoProjeto[];
  permissoes_atualizadas_em?: string | null;
}

export interface CasaDoProjeto {
  id: number;
  codigo: string;
  descricao: string;
  localizacao?: string | null;
  status: string;
  unidade: string;
  capacidade_total: number;
  /** Quanto deste espaço o projeto já tomou no período. */
  reservado_pelo_projeto: number;
  pode_configurar: boolean;
  reservas: {
    id: number;
    quantidade: number;
    data_inicio: string | null;
    data_fim: string | null;
    status: string;
    minha: boolean;
  }[];
}

export type SituacaoProjeto = 'PENDENTE' | 'APROVADO' | 'RECUSADO';

export interface ProjetoDoContexto {
  id: number;
  codigo: string;
  titulo: string;
  descricao?: string | null;
  data_inicio?: string | null;
  data_fim?: string | null;
  status?: string | null;
  /** Situação que não aceita novas reservas (suspenso, concluído, cancelado). */
  encerrado: boolean;
  /** Situação da proposta. Só APROVADO aceita reserva. */
  situacao: SituacaoProjeto;
  /** Preenchido quando a administração recusou a proposta. */
  motivo_recusa?: string | null;
  responsavel?: { id: number; nome: string } | null;
  sou_lider: boolean;
  funcao?: string | null;
  papel: PapelEquipe | 'ADM' | null;
  permissoes: PermissaoProjeto[];
  casas_vegetacao: CasaDoProjeto[];
}

/** Resposta de /me/contexto: o que o front precisa logo depois do login. */
export interface Contexto {
  funcionario: FuncionarioApi;
  adm: boolean;
  /** Convites para projetos esperando resposta desta pessoa. */
  convites_pendentes?: number;
  projetos: ProjetoDoContexto[];
  casas_acessiveis: {
    id: number;
    codigo: string;
    descricao: string;
    localizacao?: string | null;
    status: string;
    unidade_capacidade: string;
    capacidade_total: number;
  }[];
  pode: {
    gerenciar_projetos: boolean;
    gerenciar_permissoes: boolean;
    /** Propor um projeto novo — qualquer pessoa ativa pode. */
    criar_projeto: boolean;
    /** Decidir sobre as propostas dos outros — só a administração. */
    aprovar_projeto: boolean;
    ver_auditoria: boolean;
    criar_reserva: boolean;
    aprovar_reserva: boolean;
    configurar_casa: boolean;
    adicionar_membro: boolean;
    cadastrar_funcionario: boolean;
  };
}

export interface CatalogoPermissoes {
  papeis: PapelEquipe[];
  grupos: Record<
    string,
    { titulo: string; itens: { chave: PermissaoProjeto; rotulo: string; descricao: string }[] }
  >;
  sugestoes: Record<PapelEquipe, PermissaoProjeto[]>;
}

/** Projetos, casas e permissões do usuário logado. */
export function getContexto(): Promise<Contexto> {
  return buscar('/me/contexto', 'o seu contexto de acesso');
}

/** Catálogo de permissões — monta os checkboxes da tela do adm sem hardcode. */
export function getCatalogoPermissoes(): Promise<CatalogoPermissoes> {
  return buscar('/permissoes/catalogo', 'o catálogo de permissões');
}

export interface StatusProjetoApi {
  id: number;
  descricao: string;
  /** Situação que não aceita novas reservas. */
  encerrado: boolean;
}

/** Situações de projeto (em elaboração, em andamento, suspenso...). */
export function getStatusProjeto(): Promise<StatusProjetoApi[]> {
  return buscar('/status-projeto', 'os status de projeto');
}

export function getProjetos(situacao?: SituacaoProjeto): Promise<any> {
  const filtro = situacao ? `&situacao=${situacao}` : '';
  return buscar(`/projetos?per_page=200${filtro}`, 'os projetos');
}

/** Administração aceita a proposta: o projeto passa a valer para reservas. */
/* ===========================================================================
   Sino de avisos
   =========================================================================== */

export type TomAviso = 'urgente' | 'atencao' | 'ok' | 'info';

export interface AvisoApi {
  /** Estável: é por ela que o "lido" é guardado. */
  chave: string;
  tipo: string;
  tom: TomAviso;
  titulo: string;
  texto: string;
  quando: string | null;
  lida: boolean;
  /** Para onde o clique leva. */
  link: { secao: string; convites?: boolean; filtro?: string };
}

export function getAvisos(): Promise<{ nao_lidas: number; avisos: AvisoApi[] }> {
  return buscar('/notificacoes', 'os avisos');
}

export function marcarAvisosLidos(chaves: string[] | 'todas'): Promise<{ marcadas: number }> {
  return enviar(
    'POST',
    '/notificacoes/lidas',
    chaves === 'todas' ? { todas: true } : { chaves },
    'Não foi possível marcar os avisos.',
  );
}

/* ===========================================================================
   Convites para projetos
   =========================================================================== */

export type StatusConvite = 'PENDENTE' | 'ACEITO' | 'RECUSADO' | 'CANCELADO';

export interface ConviteProjetoApi {
  id: number;
  status: StatusConvite;
  mensagem: string | null;
  criado_em: string | null;
  respondido_em: string | null;
  projeto: { id: number; codigo: string; titulo: string; descricao?: string | null; lider?: string | null } | null;
  convidado: { id: number; nome: string; cargo: string | null } | null;
  autor: { id: number; nome: string; cargo: string | null } | null;
}

export interface ConvitesApi {
  /** Os que esperam a resposta da pessoa logada. */
  recebidos: ConviteProjetoApi[];
  /** Os que ela mandou nos últimos 90 dias, em qualquer situação. */
  enviados: ConviteProjetoApi[];
}

export function getConvites(): Promise<ConvitesApi> {
  return buscar('/convites', 'os convites');
}

export function convidarParaProjeto(
  projetoId: number,
  convidados: number[],
  mensagem: string | null,
): Promise<{ message: string; convites: ConviteProjetoApi[]; pulados: { id: number; motivo: string }[] }> {
  return enviar('POST', `/projetos/${projetoId}/convites`, { convidados, mensagem }, 'Não foi possível enviar os convites.');
}

export function aceitarConvite(id: number): Promise<{ message: string }> {
  return enviar('POST', `/convites/${id}/aceitar`, undefined, 'Não foi possível aceitar o convite.');
}

export function recusarConvite(id: number): Promise<{ message: string }> {
  return enviar('POST', `/convites/${id}/recusar`, undefined, 'Não foi possível recusar o convite.');
}

export function cancelarConvite(id: number): Promise<{ message: string }> {
  return enviar('DELETE', `/convites/${id}`, undefined, 'Não foi possível cancelar o convite.');
}

export function aprovarProjeto(id: number): Promise<any> {
  return enviar('POST', `/projetos/${id}/aprovar`, undefined, 'Não foi possível aprovar o projeto.');
}

/** Administração recusa a proposta, dizendo o motivo. */
export function recusarProjeto(id: number, motivo: string): Promise<any> {
  return enviar('POST', `/projetos/${id}/recusar`, { motivo }, 'Não foi possível recusar o projeto.');
}

export interface DadosProjeto {
  /** Nasce sozinho no back-end (P-2026-001); a tela não manda mais. */
  codigo?: string;
  titulo: string;
  descricao?: string | null;
  data_inicio?: string | null;
  data_fim?: string | null;
  status_projeto_id?: number | null;
  /** Pesquisador responsável: entra na equipe como líder. */
  funcionario_id?: number | null;
  /** Participantes, só na criação: entram na equipe sem permissão. */
  colaboradores?: number[];
}

export function criarProjeto(dados: DadosProjeto): Promise<any> {
  return enviar('POST', '/projetos', dados, 'Não foi possível criar o projeto.');
}

export function atualizarProjeto(id: number, dados: DadosProjeto): Promise<any> {
  return enviar('PUT', `/projetos/${id}`, dados, 'Não foi possível salvar o projeto.');
}

export function excluirProjeto(id: number): Promise<any> {
  return enviar('DELETE', `/projetos/${id}`, undefined, 'Não foi possível excluir o projeto.');
}

export function getEquipe(projetoId: number): Promise<{ projeto: any; equipe: MembroEquipe[] }> {
  return buscar(`/projetos/${projetoId}/equipe`, 'a equipe do projeto');
}

export function adicionarMembro(
  projetoId: number,
  dados: {
    funcionario_id: number;
    papel?: PapelEquipe;
    /** Função dentro do projeto, texto livre (ex.: "bolsista"). */
    funcao?: string | null;
    permissoes?: PermissaoProjeto[];
  },
): Promise<MembroEquipe> {
  return enviar('POST', `/projetos/${projetoId}/equipe`, dados, 'Não foi possível incluir o membro.');
}

export function atualizarMembro(
  projetoId: number,
  funcionarioId: number,
  dados: {
    papel?: PapelEquipe;
    funcao?: string | null;
    permissoes?: PermissaoProjeto[];
  },
): Promise<MembroEquipe> {
  return enviar(
    'PUT',
    `/projetos/${projetoId}/equipe/${funcionarioId}`,
    dados,
    'Não foi possível salvar o membro.',
  );
}

/** Concede ou revoga permissões de um membro. Só o adm consegue. */
export function definirPermissoes(
  projetoId: number,
  funcionarioId: number,
  permissoes: PermissaoProjeto[],
): Promise<MembroEquipe> {
  return enviar(
    'PUT',
    `/projetos/${projetoId}/equipe/${funcionarioId}/permissoes`,
    { permissoes },
    'Não foi possível salvar as permissões.',
  );
}

export function removerMembro(projetoId: number, funcionarioId: number): Promise<any> {
  return enviar(
    'DELETE',
    `/projetos/${projetoId}/equipe/${funcionarioId}`,
    undefined,
    'Não foi possível remover o membro.',
  );
}

/* ===========================================================================
   Auditoria
   =========================================================================== */

export interface RegistroAuditoria {
  id: number;
  /** CRIOU, ALTEROU, EXCLUIU, ENTROU, SAIU, APROVOU, NEGADO... */
  acao: string;
  entidade: string;
  entidade_id: number | null;
  /** Texto curto que identifica o registro (código, nome...). */
  rotulo: string | null;
  /** Nome de quem fez, guardado na hora: sobrevive à remoção do cadastro. */
  funcionario_nome?: string | null;
  alteracoes: Record<string, { de?: unknown; para?: unknown }> | null;
  ip?: string | null;
  created_at: string;
  funcionario?: { id: number; nome: string; email?: string } | null;
  projeto?: { id: number; codigo: string; descricao: string } | null;
}

/** Envelope do paginador do Laravel, como a trilha devolve. */
export interface PaginaAuditoria {
  data: RegistroAuditoria[];
  current_page: number;
  last_page: number;
  per_page: number;
  total: number;
}

/** Valores que realmente aparecem na trilha, para montar os filtros. */
export interface FiltrosAuditoria {
  acoes: string[];
  entidades: string[];
  funcionarios: { id: number; nome: string; email?: string }[];
  projetos: { id: number; codigo: string; titulo: string }[];
}

export function getFiltrosAuditoria(): Promise<FiltrosAuditoria> {
  return buscar('/auditorias/filtros', 'os filtros do histórico');
}

/** Trilha de alterações: quem mexeu no que e quando. */
export function getAuditoria(filtros: {
  entidade?: string;
  entidade_id?: number;
  acao?: string;
  funcionario_id?: number;
  projeto_id?: number;
  de?: string;
  ate?: string;
  busca?: string;
  per_page?: number;
  page?: number;
} = {}): Promise<PaginaAuditoria> {
  const busca = new URLSearchParams();
  Object.entries(filtros).forEach(([chave, valor]) => {
    if (valor !== undefined && valor !== null && valor !== '') busca.set(chave, String(valor));
  });
  if (!busca.has('per_page')) busca.set('per_page', '30');

  return buscar<PaginaAuditoria>(`/auditorias?${busca.toString()}`, 'o histórico de alterações');
}

/* ===========================================================================
   Sessão
   =========================================================================== */

/** Funcionário como a API devolve em /login. */
export interface FuncionarioApi {
  id: number;
  nome: string;
  matricula?: string | null;
  email?: string;
  tipo?: string;
  /** Nome do cargo, já resolvido pelo back-end (não a relação inteira). */
  cargo?: string | null;
  /** Id do cargo, que o formulário de edição precisa para pré-selecionar. */
  cargo_id?: number | null;
  super_usuario?: boolean;
  ativo?: boolean;
  /** ATIVO, CONVITE_PENDENTE (sem senha criada) ou INATIVO. */
  situacao?: string;
  /** Estado do convite de quem ainda não criou a senha. */
  convite?: import('../types').ConviteDoUsuario | null;
  /** Em quantos projetos a pessoa está na equipe. */
  projetos?: number;
  ultimo_acesso_em?: string | null;
}

export interface RespostaLogin {
  token: string;
  token_type?: string;
  funcionario: FuncionarioApi;
}

/** Autentica no back-end e devolve o token junto com o funcionário. */
export async function login(email: string, senha: string): Promise<RespostaLogin> {
  const resposta = await fetch(`${API_URL}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email: email.trim().toLowerCase(), senha }),
  });

  const dados = await resposta.json().catch(() => null);

  if (!resposta.ok) {
    throw new Error(mensagemDoErro(dados, 'E-mail ou senha incorretos.'));
  }

  return dados as RespostaLogin;
}

/** Pede o link de criação de nova senha. A resposta é sempre a mesma. */
export function esqueciSenha(email: string): Promise<{ message?: string }> {
  return enviar('POST', '/esqueci-senha', { email }, 'Não foi possível enviar o e-mail.');
}

/** O que a tela do link mostra antes de pedir a senha. */
export interface TokenAcesso {
  valido: boolean;
  tipo: 'CONVITE' | 'NOVA_SENHA';
  primeiro_acesso: boolean;
  nome: string;
  email: string;
  expira_em: string;
}

/**
 * Confere o token do link (`/definir-senha?token=...`) e diz para quem ele é.
 * Rota pública: sem token de sessão. Um 422 aqui é "link inválido ou
 * vencido", não sessão perdida — por isso não passa por `buscar`.
 */
export async function consultarTokenAcesso(token: string): Promise<TokenAcesso> {
  const resposta = await fetch(`${API_URL}/definir-senha/${encodeURIComponent(token)}`, {
    headers: { Accept: 'application/json' },
  });
  const dados = await resposta.json().catch(() => null);

  if (!resposta.ok) {
    throw new ErroApi(mensagemDoErro(dados, 'Link inválido ou vencido.'), resposta.status, dados);
  }

  return dados as TokenAcesso;
}

export interface SenhaDefinida {
  message: string;
  nome: string;
  email: string;
}

/** Grava a senha escolhida pelo link. Rota pública, sem sessão. */
export async function definirSenha(
  token: string,
  senha: string,
  confirmacao: string,
): Promise<SenhaDefinida> {
  const resposta = await fetch(`${API_URL}/definir-senha`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ token, senha, senha_confirmation: confirmacao }),
  });
  const dados = await resposta.json().catch(() => null);

  if (!resposta.ok) {
    throw new ErroApi(mensagemDoErro(dados, 'Não foi possível salvar a senha.'), resposta.status, dados);
  }

  return dados as SenhaDefinida;
}
