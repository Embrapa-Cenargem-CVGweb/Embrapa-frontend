/**
 * Assistente do CVGWeb — widget no canto inferior direito.
 *
 * A pergunta vai para a LLM junto com `src/chat/base-conhecimento.md` já
 * preenchido com o estado do sistema (ocupação, responsável, período,
 * projeto e finalidade). O widget só aparece depois da entrada no sistema.
 */
import { montarPrompt } from '../chat/contexto';
import { el, show } from '../lib/dom';
import { html, raw } from '../lib/html';
import { LLM_PRONTA, perguntar, type Fala } from '../services/llm';

const SUGESTOES = [
  'Quem está usando a Estufa 03 e até quando?',
  'O que está sendo cultivado nas estufas ocupadas?',
  'Quais espaços estão livres no Setor Sul?',
];

const ABERTURA =
  'Olá! Posso dizer quem está usando cada casa de vegetação, por quanto tempo '
  + 'e qual projeto está lá dentro. Pergunte à vontade.';

const SEM_CHAVE =
  'O assistente está sem chave de LLM. Defina **VITE_GROQ_API_KEY** no arquivo '
  + '`.env` e reinicie o `npm run dev`.';

const historico: Fala[] = [];

let pensando = false;
let emCurso: AbortController | null = null;

/* ===========================================================================
   Texto da resposta
   =========================================================================== */

/**
 * Markdown mínimo: a LLM é instruída a usar só negrito, listas e parágrafos.
 * O texto passa primeiro pelo escape de `html`, então nada vindo da resposta
 * consegue injetar marcação.
 */
function formatar(texto: string): string {
  const escapado = html`${texto}`;

  return escapado
    .split(/\n{2,}/)
    .map((bloco) => {
      const linhas = bloco.split('\n');
      const itens = linhas.filter((l) => /^\s*[-*]\s+/.test(l));

      const marcar = (t: string): string =>
        t
          .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
          .replace(/`([^`]+)`/g, '<code>$1</code>');

      if (itens.length === linhas.length && itens.length > 0) {
        const li = itens
          .map((l) => `<li>${marcar(l.replace(/^\s*[-*]\s+/, ''))}</li>`)
          .join('');
        return `<ul>${li}</ul>`;
      }
      return `<p>${marcar(linhas.join('<br />'))}</p>`;
    })
    .join('');
}

/* ===========================================================================
   Desenho
   =========================================================================== */

function balao(papel: Fala['papel'] | 'erro', corpo: string): string {
  const autor = papel === 'user' ? 'Você' : 'Assistente';
  return html`
    <div class="chat__msg chat__msg--${papel}">
      <span class="sr-only">${autor}:</span>
      <div class="chat__bolha">${raw(corpo)}</div>
    </div>
  `;
}

function renderizar(): void {
  const log = el('chat-log');
  if (!log) return;

  const primeira = balao('assistant', formatar(LLM_PRONTA ? ABERTURA : SEM_CHAVE));
  const falas = historico.map((f) => balao(f.papel, formatar(f.texto)));

  const carregando = pensando
    ? html`
      <div class="chat__msg chat__msg--assistant">
        <div class="chat__bolha chat__bolha--pensando" role="status">
          <span class="sr-only">Consultando o sistema…</span>
          <span class="chat__ponto"></span><span class="chat__ponto"></span><span class="chat__ponto"></span>
        </div>
      </div>
    `
    : '';

  log.innerHTML = primeira + falas.join('') + carregando;
  log.scrollTop = log.scrollHeight;

  show(el('chat-sugestoes'), historico.length === 0 && LLM_PRONTA);
  show(el('chat-limpar'), historico.length > 0);

  const enviar = el<HTMLButtonElement>('chat-enviar');
  if (enviar) enviar.disabled = pensando || !LLM_PRONTA;

  const entrada = el<HTMLTextAreaElement>('chat-entrada');
  if (entrada) entrada.disabled = !LLM_PRONTA;
}

/* ===========================================================================
   Abrir, fechar e limpar
   =========================================================================== */

function estaAberto(): boolean {
  return el('chat-janela')?.hidden === false;
}

export function alternarChat(forcar?: boolean): void {
  const janela = el('chat-janela');
  const fab = el('chat-fab');
  if (!janela || !fab) return;

  const abrir = forcar ?? janela.hidden;
  show(janela, abrir);
  fab.setAttribute('aria-expanded', String(abrir));

  if (abrir) {
    renderizar();
    el<HTMLTextAreaElement>('chat-entrada')?.focus();
  } else {
    emCurso?.abort();
    emCurso = null;
    pensando = false;
    fab.focus();
  }
}

export function fecharChat(): void {
  alternarChat(false);
}

/** Mostra ou esconde o widget inteiro (entrada e saída da sessão). */
export function mostrarChat(visivel: boolean): void {
  if (!visivel) {
    alternarChat(false);
    historico.length = 0;
  }
  show(el('chat'), visivel);
}

export function limparConversa(): void {
  emCurso?.abort();
  emCurso = null;
  pensando = false;
  historico.length = 0;
  renderizar();
  el<HTMLTextAreaElement>('chat-entrada')?.focus();
}

/* ===========================================================================
   Envio
   =========================================================================== */

function ajustarAltura(campo: HTMLTextAreaElement): void {
  campo.style.height = 'auto';
  campo.style.height = `${Math.min(campo.scrollHeight, 120)}px`;
}

async function enviar(pergunta: string): Promise<void> {
  const texto = pergunta.trim();
  if (!texto || pensando || !LLM_PRONTA) return;

  const campo = el<HTMLTextAreaElement>('chat-entrada');
  if (campo) {
    campo.value = '';
    ajustarAltura(campo);
  }

  historico.push({ papel: 'user', texto });
  pensando = true;
  renderizar();

  emCurso = new AbortController();

  try {
    // O prompt é montado agora, não no boot: releva a API se preciso, então a
    // resposta reflete a reserva feita há dez segundos — por outra pessoa,
    // em outra máquina.
    const resposta = await perguntar(await montarPrompt(), historico, emCurso.signal);
    historico.push({ papel: 'assistant', texto: resposta });
  } catch (erro) {
    if (erro instanceof DOMException && erro.name === 'AbortError') return;
    historico.push({
      papel: 'assistant',
      texto: erro instanceof Error ? erro.message : 'Não foi possível responder agora.',
    });
  } finally {
    emCurso = null;
    pensando = false;
    renderizar();
  }
}

export function sugerir(texto: string): void {
  void enviar(texto);
}

/* ===========================================================================
   Boot
   =========================================================================== */

export function iniciarChat(): void {
  const sugestoes = el('chat-sugestoes');
  if (sugestoes) {
    sugestoes.innerHTML = SUGESTOES.map(
      (s) => html`
        <button type="button" class="chat__sugestao" data-action="chat-sugerir" data-texto="${s}">
          ${s}
        </button>
      `,
    ).join('');
  }

  el<HTMLFormElement>('chat-form')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    void enviar(el<HTMLTextAreaElement>('chat-entrada')?.value ?? '');
  });

  const campo = el<HTMLTextAreaElement>('chat-entrada');
  campo?.addEventListener('input', () => ajustarAltura(campo));
  campo?.addEventListener('keydown', (ev) => {
    // Enter envia; Shift+Enter quebra linha.
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      void enviar(campo.value);
    }
  });

  // Esc fecha o assistente, sem interferir nos modais (que ficam acima).
  el('chat')?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && estaAberto()) {
      ev.stopPropagation();
      fecharChat();
    }
  });

  if (!LLM_PRONTA) {
    console.warn('[CVGWeb] assistente sem VITE_GROQ_API_KEY: o widget abre, mas não consulta a LLM.');
  }

  renderizar();
}
