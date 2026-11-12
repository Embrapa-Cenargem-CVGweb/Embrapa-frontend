/**
 * Assistente do CVGWeb — lado do navegador.
 *
 * Este módulo NÃO fala com a Groq. Ele fala com `POST /api/assistente` do
 * próprio back-end Laravel, que guarda a chave da LLM e monta o prompt a
 * partir do banco. Antes a chave vinha de `VITE_GROQ_API_KEY`, e tudo que
 * começa com `VITE_` entra no JavaScript publicado: qualquer visitante abria o
 * DevTools e copiava a chave.
 *
 * O que vai daqui para o servidor é só a conversa (papel + texto). Regras do
 * assistente, estado das estufas e escolha do modelo são responsabilidade do
 * back-end (`app/Services/Assistente`).
 */
import { ErroApi, tokenSalvo } from './api';

const API_URL = import.meta.env.VITE_API_URL;

export type Papel = 'user' | 'assistant';

export interface Fala {
  papel: Papel;
  texto: string;
}

/** Quantas falas anteriores acompanham a pergunta. */
const JANELA = 8;

/**
 * Se o servidor tem chave configurada. Começa `null` (ainda não perguntou):
 * o widget trata como indisponível até `verificarAssistente` responder.
 */
let disponivel: boolean | null = null;

/** Qual modelo respondeu por último — o widget mostra no rodapé. */
let modeloEmUso = '';

export function llmPronta(): boolean {
  return disponivel === true;
}

export function modeloAtual(): string {
  return modeloEmUso;
}

function cabecalhos(): HeadersInit {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  const token = tokenSalvo();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/**
 * Pergunta ao back-end se o assistente está configurado. Chamado quando o
 * widget monta; sem rede ou sem sessão, fica indisponível e o widget avisa.
 */
export async function verificarAssistente(): Promise<boolean> {
  try {
    const resposta = await fetch(`${API_URL}/assistente`, { headers: cabecalhos() });
    const dados = (await resposta.json().catch(() => null)) as { disponivel?: boolean } | null;
    disponivel = resposta.ok && dados?.disponivel === true;
  } catch {
    disponivel = false;
  }
  return disponivel;
}

/** Devolve o assistente ao estado "não sei": a próxima abertura pergunta de novo. */
export function esquecerDisponibilidade(): void {
  disponivel = null;
}

interface RespostaAssistente {
  resposta?: string;
  modelo?: string;
  message?: string;
}

/**
 * Manda a conversa para o back-end e devolve o texto da resposta.
 * O servidor monta o prompt com o estado atual do banco: a resposta reflete a
 * reserva feita há dez segundos, por outra pessoa, em outra máquina.
 */
export async function perguntar(historico: readonly Fala[], sinal?: AbortSignal): Promise<string> {
  if (!llmPronta()) {
    throw new Error('O assistente não está disponível neste servidor.');
  }

  let resposta: Response;
  try {
    resposta = await fetch(`${API_URL}/assistente`, {
      method: 'POST',
      signal: sinal,
      headers: cabecalhos(),
      body: JSON.stringify({
        mensagens: historico.slice(-JANELA).map((f) => ({ papel: f.papel, texto: f.texto })),
      }),
    });
  } catch (erro) {
    if (erro instanceof DOMException && erro.name === 'AbortError') throw erro;
    throw new Error('Não foi possível falar com o servidor. Verifique a conexão.');
  }

  const dados = (await resposta.json().catch(() => ({}))) as RespostaAssistente;

  if (!resposta.ok) {
    // 503 = servidor sem chave: o widget fecha a entrada em vez de insistir.
    if (resposta.status === 503) disponivel = false;
    throw new ErroApi(
      dados.message || `O assistente respondeu com erro (HTTP ${resposta.status}).`,
      resposta.status,
      dados,
    );
  }

  const texto = dados.resposta?.trim();
  if (!texto) throw new Error('O assistente respondeu em branco.');

  modeloEmUso = dados.modelo ?? '';
  return texto;
}
