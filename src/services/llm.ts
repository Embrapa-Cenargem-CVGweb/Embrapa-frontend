/**
 * Cliente da LLM usada pelo assistente (Groq, API compatível com a da OpenAI).
 *
 * O modelo não fica fixo no código: nomes de modelo entram e saem de linha com
 * frequência e cada conta tem acesso a um conjunto diferente. Sem
 * `VITE_GROQ_MODEL` definido, o cliente pergunta à própria API quais modelos a
 * chave alcança (`GET /models`) e escolhe o melhor da lista de preferência.
 * Se o modelo escolhido for recusado, ele descobre de novo, sem o recusado, e
 * repete a pergunta uma vez.
 *
 * ATENÇÃO: a chave vem de `VITE_GROQ_API_KEY` e tudo que começa com `VITE_`
 * entra no JavaScript publicado — qualquer visitante consegue lê-la no
 * navegador. Serve para desenvolvimento e demonstração. Em produção, troque
 * `BASE` por uma rota do back-end Laravel (ex.: `${VITE_API_URL}/assistente`)
 * que guarde a chave no servidor.
 */
const BASE = 'https://api.groq.com/openai/v1';

const CHAVE = import.meta.env.VITE_GROQ_API_KEY ?? '';

/** Modelo fixado à mão no .env. Vazio = descobrir pela API. */
const MODELO_FIXO = (import.meta.env.VITE_GROQ_MODEL ?? '').trim();

/** Ordem de preferência entre os modelos de conversa da Groq. */
const PREFERIDOS = [
  'llama-3.3-70b-versatile',
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'llama-3.1-8b-instant',
];

/** Modelos que existem na conta mas não servem para conversar. */
const NAO_SERVE = /whisper|tts|orpheus|guard|embed|moderation|vision-ocr/i;

/** Sem chave configurada o widget avisa em vez de tentar a rede. */
export const LLM_PRONTA = CHAVE.length > 0;

export type Papel = 'user' | 'assistant';

export interface Fala {
  papel: Papel;
  texto: string;
}

/** Quantas falas anteriores acompanham a pergunta. */
const JANELA = 8;

function cabecalhos(): HeadersInit {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${CHAVE}`,
  };
}

/* ===========================================================================
   Descoberta do modelo
   =========================================================================== */

interface ListaModelos {
  data?: { id?: string }[];
}

/** Ids de conversa que esta chave alcança, já na ordem de preferência. */
let catalogo: string[] | null = null;

async function listarModelos(): Promise<string[]> {
  if (catalogo) return catalogo;

  const resposta = await fetch(`${BASE}/models`, { headers: cabecalhos() });
  if (!resposta.ok) {
    throw new Error(
      resposta.status === 401 || resposta.status === 403
        ? 'A chave da LLM foi recusada. Confira VITE_GROQ_API_KEY no arquivo .env.'
        : `Não foi possível listar os modelos da LLM (HTTP ${resposta.status}).`,
    );
  }

  const dados = (await resposta.json()) as ListaModelos;
  const ids = (dados.data ?? [])
    .map((m) => m.id ?? '')
    .filter((id) => id && !NAO_SERVE.test(id));

  // Preferidos primeiro, na ordem acima; o resto depois, alfabético.
  const preferidos = PREFERIDOS.filter((id) => ids.includes(id));
  const demais = ids.filter((id) => !preferidos.includes(id)).sort();

  catalogo = [...preferidos, ...demais];
  if (!catalogo.length) {
    throw new Error('Nenhum modelo de conversa disponível para esta chave da Groq.');
  }

  console.info(`[CVGWeb] modelos da LLM disponíveis: ${catalogo.join(', ')}`);
  return catalogo;
}

/** Modelos já recusados nesta sessão, para não tentar de novo. */
const recusados = new Set<string>();

async function escolherModelo(): Promise<string> {
  if (MODELO_FIXO && !recusados.has(MODELO_FIXO)) return MODELO_FIXO;

  const disponiveis = (await listarModelos()).filter((id) => !recusados.has(id));
  if (!disponiveis.length) {
    throw new Error('Nenhum modelo da Groq respondeu. Verifique a conta em console.groq.com.');
  }
  return disponiveis[0];
}

/** Qual modelo respondeu por último — o widget mostra no rodapé. */
let modeloEmUso = '';

export function modeloAtual(): string {
  return modeloEmUso;
}

/* ===========================================================================
   Erros
   =========================================================================== */

interface RespostaApi {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string; code?: string };
}

/** O modelo não existe, saiu de linha ou a conta não o alcança. */
function eProblemaDeModelo(status: number, dados: RespostaApi): boolean {
  if (status !== 404 && status !== 400) return false;
  const texto = `${dados.error?.code ?? ''} ${dados.error?.message ?? ''}`.toLowerCase();
  return (
    status === 404
    || texto.includes('model')
    || texto.includes('decommission')
    || texto.includes('does not exist')
  );
}

function mensagemDeErro(status: number, detalhe?: string): string {
  if (status === 401 || status === 403) {
    return 'A chave da LLM foi recusada. Confira VITE_GROQ_API_KEY no arquivo .env.';
  }
  if (status === 429) {
    return 'O limite de uso da LLM foi atingido. Tente de novo em alguns instantes.';
  }
  return detalhe || `A LLM respondeu com erro (HTTP ${status}).`;
}

/* ===========================================================================
   Pergunta
   =========================================================================== */

async function chamar(
  modelo: string,
  mensagens: unknown[],
  sinal?: AbortSignal,
): Promise<{ ok: true; texto: string } | { ok: false; status: number; dados: RespostaApi }> {
  let resposta: Response;
  try {
    resposta = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      signal: sinal,
      headers: cabecalhos(),
      body: JSON.stringify({
        model: modelo,
        messages: mensagens,
        temperature: 0.2,
        max_tokens: 600,
      }),
    });
  } catch (erro) {
    if (erro instanceof DOMException && erro.name === 'AbortError') throw erro;
    throw new Error('Não foi possível falar com a LLM. Verifique a conexão.');
  }

  const dados = (await resposta.json().catch(() => ({}))) as RespostaApi;
  if (!resposta.ok) return { ok: false, status: resposta.status, dados };

  const texto = dados.choices?.[0]?.message?.content?.trim();
  if (!texto) throw new Error('A LLM respondeu em branco.');
  return { ok: true, texto };
}

/**
 * Manda a conversa para a LLM e devolve o texto da resposta.
 * `sistema` é a base de conhecimento já preenchida com o estado do sistema.
 */
export async function perguntar(
  sistema: string,
  historico: readonly Fala[],
  sinal?: AbortSignal,
): Promise<string> {
  if (!LLM_PRONTA) {
    throw new Error('Nenhuma chave de LLM configurada.');
  }

  const mensagens = [
    { role: 'system', content: sistema },
    ...historico.slice(-JANELA).map((f) => ({
      role: f.papel === 'user' ? 'user' : 'assistant',
      content: f.texto,
    })),
  ];

  // Duas tentativas: a segunda só acontece quando o modelo é recusado, já com
  // outro modelo da lista.
  for (let tentativa = 0; tentativa < 2; tentativa += 1) {
    const modelo = await escolherModelo();
    const r = await chamar(modelo, mensagens, sinal);

    if (r.ok) {
      modeloEmUso = modelo;
      return r.texto;
    }

    if (eProblemaDeModelo(r.status, r.dados) && !recusados.has(modelo)) {
      console.warn(`[CVGWeb] modelo "${modelo}" recusado pela conta; procurando outro.`);
      recusados.add(modelo);
      catalogo = null; // relê a lista: pode ter mudado do lado da Groq
      continue;
    }

    throw new Error(mensagemDeErro(r.status, r.dados.error?.message));
  }

  throw new Error(
    'Nenhum modelo da Groq aceitou a pergunta. Veja no console do navegador a lista'
    + ' de modelos da sua chave e escolha um em VITE_GROQ_MODEL.',
  );
}
