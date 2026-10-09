/**
 * Avisos temporários.
 *
 * O contêiner é uma região viva (`role="status"`, `aria-live="polite"`), por
 * isso o leitor de tela anuncia a mensagem sem roubar o foco de quem está
 * digitando.
 */
import { el } from './dom';
import { html, icone } from './html';

type Tipo = 'success' | 'error' | 'info';

const ICONES: Record<Tipo, string> = {
  success: 'circle-check',
  error: 'circle-x',
  info: 'info',
};

const DURACAO = 4000;
const SAIDA = 220;

export function aviso(mensagem: string, tipo: Tipo = 'info'): void {
  const wrap = el('toasts');
  if (!wrap) return;

  const node = document.createElement('div');
  node.className = 'toast';
  node.dataset.kind = tipo;
  // Erro interrompe a leitura em curso; sucesso e informação esperam a vez.
  node.setAttribute('role', tipo === 'error' ? 'alert' : 'status');
  node.innerHTML = html`${icone(ICONES[tipo])}<span>${mensagem}</span>`;
  wrap.append(node);

  window.setTimeout(() => {
    node.classList.add('is-leaving');
    window.setTimeout(() => node.remove(), SAIDA);
  }, DURACAO);
}
