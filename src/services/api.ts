/**
 * Acesso à API Laravel do CVGWeb.
 *
 * Só é usada quando VITE_API_URL está configurada; sem ela o app roda em modo
 * demonstração com dados locais.
 *
 * Toda escrita passa por aqui — antes o front só sabia ler, e reserva,
 * aprovação, cancelamento e cadastro de usuário morriam no localStorage.
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
    return localStorage.getItem(CHAVE_TOKEN);
  } catch {
    return null;
  }
}

export function guardarToken(token: string): void {
  try {
    localStorage.setItem(CHAVE_TOKEN, token);
  } catch {
    /* storage indisponível */
  }
}

export function descartarToken(): void {
  try {
    localStorage.removeItem(CHAVE_TOKEN);
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

async function buscar<T>(caminho: string, oQue: string): Promise<T> {
  const resposta = await fetch(`${API_URL}${caminho}`, { headers: cabecalhos() });

  if (!resposta.ok) {
    const dados = await resposta.json().catch(() => null);
    throw new Error(mensagemDoErro(dados, `Falha ao buscar ${oQue} (HTTP ${resposta.status})`));
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
    throw new Error(mensagemDoErro(dados, padrao));
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
  nick: string;
  email: string;
  perfil?: string;
  cargo_id?: number | null;
}

/**
 * Cadastra o usuário. O back-end manda o e-mail com o link de criação de
 * senha; nenhuma senha trafega por aqui.
 */
export function criarFuncionario(dados: NovoFuncionario): Promise<any> {
  return enviar('POST', '/funcionarios', dados, 'Não foi possível cadastrar o usuário.');
}

export function excluirFuncionario(id: number): Promise<any> {
  return enviar('DELETE', `/funcionarios/${id}`, undefined, 'Não foi possível excluir o usuário.');
}

/** Ativa ou desativa o acesso, preservando o histórico. */
export function atualizarSituacaoFuncionario(id: number, ativo: boolean): Promise<any> {
  return enviar(
    'PATCH',
    `/funcionarios/${id}/situacao`,
    { ativo },
    'Não foi possível alterar a situação do acesso.',
  );
}

export function reenviarConvite(id: number): Promise<any> {
  return enviar('POST', `/funcionarios/${id}/convite`, undefined, 'Não foi possível enviar o convite.');
}

/* ===========================================================================
   Sessão
   =========================================================================== */

/** Funcionário como a API devolve em /login. */
export interface FuncionarioApi {
  id: number;
  nome: string;
  nick?: string;
  email?: string;
  tipo?: string;
  cargo?: string;
  super_usuario?: boolean;
  situacao?: string;
}

export interface RespostaLogin {
  token: string;
  token_type?: string;
  funcionario: FuncionarioApi;
}

/** Autentica no back-end e devolve o token junto com o funcionário. */
export async function login(nick: string, senha: string): Promise<RespostaLogin> {
  const resposta = await fetch(`${API_URL}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ nick, senha }),
  });

  const dados = await resposta.json().catch(() => null);

  if (!resposta.ok) {
    throw new Error(mensagemDoErro(dados, 'Usuário ou senha incorretos.'));
  }

  return dados as RespostaLogin;
}

/** Pede o link de criação de nova senha. A resposta é sempre a mesma. */
export function esqueciSenha(email: string): Promise<any> {
  return enviar('POST', '/esqueci-senha', { email }, 'Não foi possível enviar o e-mail.');
}
