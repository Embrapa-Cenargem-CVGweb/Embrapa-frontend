/**
 * Acesso à API Laravel do CVGWeb.
 *
 * Só é usada quando VITE_API_URL está configurada; sem ela o app roda em modo
 * demonstração com dados locais.
 */
const API_URL = import.meta.env.VITE_API_URL;

function cabecalhos(): HeadersInit {
  const headers: Record<string, string> = { Accept: 'application/json' };
  let token: string | null = null;
  try {
    token = localStorage.getItem('cvgweb:token');
  } catch {
    /* storage indisponível */
  }
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
