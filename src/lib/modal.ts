/**
 * Modais acessíveis.
 *
 * Cada modal é um `.scrim[hidden]` com um `[role="dialog"][aria-modal]` dentro.
 * Ao abrir: o resto da página recebe `inert` (nada atrás recebe foco nem é lido
 * pelo leitor de tela), o foco vai para o primeiro controle do diálogo e o
 * elemento que abriu fica guardado. Ao fechar, o foco volta para ele.
 *
 * Esc fecha o modal do topo. Clique fora do diálogo também.
 */
import { el, primeiroFocavel, qs, qsa, show } from './dom';
import { html, icone } from './html';

/** Pilha de modais abertos; o último é o do topo. */
const pilha: HTMLElement[] = [];
const origemFoco = new WeakMap<HTMLElement, HTMLElement>();

/** Nunca recebe inert: é a região viva dos avisos. */
const SEMPRE_ATIVO = new Set(['toasts']);

/**
 * Deixa inerte tudo que não é o modal do topo. Com a pilha vazia, devolve a
 * página inteira à interação.
 */
function atualizarInert(): void {
  const topo = pilha.at(-1);
  Array.from(document.body.children).forEach((filho) => {
    if (!(filho instanceof HTMLElement)) return;
    if (SEMPRE_ATIVO.has(filho.id)) return;
    if (filho.tagName === 'SCRIPT') return;
    filho.inert = topo !== undefined && filho !== topo;
  });
}

export function modalAberto(): boolean {
  return pilha.length > 0;
}

export function abrirModal(id: string): void {
  const scrim = el(id);
  if (!scrim || pilha.includes(scrim)) return;

  const anterior = document.activeElement;
  if (anterior instanceof HTMLElement) origemFoco.set(scrim, anterior);

  show(scrim, true);
  pilha.push(scrim);
  atualizarInert();

  const dialog = qs('[role="dialog"]', scrim) ?? scrim;
  (primeiroFocavel(dialog) ?? dialog).focus();
}

export function fecharModal(scrim?: HTMLElement | null): void {
  const alvo = scrim ?? pilha.at(-1);
  if (!alvo) return;

  const indice = pilha.indexOf(alvo);
  if (indice === -1) return;
  pilha.splice(indice, 1);

  show(alvo, false);
  atualizarInert();

  origemFoco.get(alvo)?.focus();
  origemFoco.delete(alvo);
}

/** Fecha o modal do topo. Devolve true se havia algo para fechar. */
function fecharTopo(): boolean {
  if (!pilha.length) return false;
  fecharModal(pilha.at(-1));
  return true;
}

export function fecharTodosModais(): void {
  while (pilha.length) fecharTopo();
}

/** Troca de modal sem deixar o foco solto no meio. */
export function trocarModal(deId: string, paraId: string): void {
  const atual = el(deId);
  if (atual && pilha.includes(atual)) fecharModal(atual);
  abrirModal(paraId);
}

/* ===========================================================================
   Confirmação
   =========================================================================== */

interface ConfirmarOpts {
  titulo: string;
  /** HTML já escapado pelo template `html`. */
  mensagem: string;
  icone?: string;
  confirmar?: string;
  cancelar?: string;
  perigo?: boolean;
}

let contador = 0;

/**
 * Diálogo de confirmação criado na hora. Resolve true se a pessoa confirmar.
 * Enter confirma, Esc cancela.
 */
export function confirmar(opts: ConfirmarOpts): Promise<boolean> {
  return new Promise((resolve) => {
    contador += 1;
    const tituloId = `confirmar-titulo-${contador}`;

    const scrim = document.createElement('div');
    scrim.className = 'scrim';
    scrim.id = `confirmar-${contador}`;
    scrim.innerHTML = html`
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="${tituloId}">
        <div class="dialog__head">
          <span class="dialog__mark">${icone(opts.icone ?? 'circle-question-mark')}</span>
          <div class="dialog__heading">
            <h2 class="dialog__title" id="${tituloId}">${opts.titulo}</h2>
            <p class="dialog__desc"></p>
          </div>
        </div>
        <div class="dialog__foot">
          <button type="button" class="btn btn--quiet" data-confirmar="nao">
            ${opts.cancelar ?? 'Cancelar'}
          </button>
          <button type="button" class="btn ${opts.perigo ? 'btn--danger' : 'btn--primary'}" data-confirmar="sim">
            ${opts.confirmar ?? 'Confirmar'}
          </button>
        </div>
      </div>
    `;

    // A mensagem já vem montada pelo template `html` de quem chamou.
    const desc = qs('.dialog__desc', scrim);
    if (desc) desc.innerHTML = opts.mensagem;

    scrim.hidden = true;
    document.body.append(scrim);
    abrirModal(scrim.id);

    // O botão de confirmar recebe o foco, não o de cancelar.
    qs<HTMLElement>('[data-confirmar="sim"]', scrim)?.focus();

    const encerrar = (resposta: boolean): void => {
      document.removeEventListener('keydown', naTecla, true);
      fecharModal(scrim);
      scrim.remove();
      resolve(resposta);
    };

    const naTecla = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        encerrar(false);
      } else if (ev.key === 'Enter' && !(ev.target instanceof HTMLButtonElement)) {
        ev.preventDefault();
        encerrar(true);
      }
    };

    document.addEventListener('keydown', naTecla, true);
    qsa<HTMLElement>('[data-confirmar]', scrim).forEach((botao) => {
      botao.addEventListener('click', () => encerrar(botao.dataset.confirmar === 'sim'));
    });
    scrim.addEventListener('click', (ev) => {
      if (ev.target === scrim) encerrar(false);
    });
  });
}

/* ===========================================================================
   Ligação global
   =========================================================================== */

export function iniciarModais(): void {
  // Esc fecha o modal do topo.
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && fecharTopo()) ev.preventDefault();
  });

  // Clique no fundo escuro fecha; clique dentro do diálogo não.
  qsa('.scrim').forEach((scrim) => {
    scrim.addEventListener('click', (ev) => {
      if (ev.target === scrim) fecharModal(scrim);
    });
  });
}
