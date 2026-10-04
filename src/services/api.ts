/**
 * Acesso à API Laravel do CVGWeb.
 *
 * Só é usada quando VITE_API_URL está configurada; sem ela o app roda em modo
 * demonstração com dados locais.
 */
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

function cabecalhos(): HeadersInit {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = tokenSalvo();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function buscar<T>(caminho: string, oQue: string): Promise<T> {
  const resposta = await fetch(`${API_URL}${caminho}`, { headers: cabecalhos() });
  if (!resposta.ok) {
    throw new Error(`Falha ao buscar ${oQue} (HTTP ${resposta.status})`);
  }
  return resposta.json() as Promise<T>;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

export function getCasasVegetacao(): Promise<any> {
  return buscar('/casas-vegetacao?per_page=100', 'as casas de vegetação');
}

export function getReservas(): Promise<any> {
  return buscar('/reservas', 'as reservas');
}

/** Funcionário como a API devolve em /login. */
export interface FuncionarioApi {
  id: number;
  nome: string;
  nick?: string;
  tipo?: string;
  cargo?: string;
  super_usuario?: boolean;
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

  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    throw new Error(dados.message || 'Usuário ou senha incorretos.');
  }
  return dados as RespostaLogin;
}
