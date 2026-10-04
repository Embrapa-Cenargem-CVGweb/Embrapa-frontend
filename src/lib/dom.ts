/**
 * Acesso ao DOM: um punhado de atalhos usados por todas as views.
 */

/** Busca por id. Avisa no console quando o elemento não existe. */
export function el<T extends HTMLElement = HTMLElement>(id: string): T | null {
  const found = document.getElementById(id);
  if (!found) console.warn(`[CVGWeb] elemento #${id} não encontrado`);
  return found as T | null;
}

export function qs<T extends Element = HTMLElement>(
  selector: string,
  root: ParentNode = document,
): T | null {
  return root.querySelector<T>(selector);
}

export function qsa<T extends Element = HTMLElement>(
  selector: string,
  root: ParentNode = document,
): T[] {
  return Array.from(root.querySelectorAll<T>(selector));
}

/** Escreve texto em um elemento por id, sem interpretar HTML. */
export function setText(id: string, value: string): void {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

/** Mostra ou esconde pelo atributo `hidden`, que também tira da ordem de foco. */
export function show(node: Element | null, visible: boolean): void {
  if (node) node.toggleAttribute('hidden', !visible);
}

/** Primeiro elemento focável dentro de um contêiner. */
const FOCUSAVEIS = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function primeiroFocavel(root: ParentNode): HTMLElement | null {
  return qsa<HTMLElement>(FOCUSAVEIS, root).find((node) => {
    const style = getComputedStyle(node);
    return style.visibility !== 'hidden' && style.display !== 'none';
  }) ?? null;
}

/** Agrupa chamadas rápidas — usado nos campos de busca. */
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  ms = 180,
): (...args: A) => void {
  let timer: number | undefined;
  return (...args: A) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), ms);
  };
}
