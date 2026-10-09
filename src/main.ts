/**
 * Ponto de entrada. Só espera o DOM e entrega o controle para a casca.
 */
import { iniciarApp } from './app';

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', iniciarApp, { once: true });
} else {
  iniciarApp();
}
