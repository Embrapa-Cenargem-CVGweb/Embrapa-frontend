/**
 * Pedido de troca de tela.
 *
 * As views não importam a casca (app.ts) — isso criaria ciclo, já que a casca
 * importa todas elas. Quem precisa levar a pessoa para outra seção chama
 * `irParaSecao()`; a casca se registra uma vez com `aoNavegar()`.
 */

export type Secao = 'mapa' | 'reservas' | 'projetos' | 'usuarios' | 'admin' | 'historico';

type Ouvinte = (secao: Secao) => void;

let ouvinte: Ouvinte | null = null;

export function aoNavegar(fn: Ouvinte): void {
  ouvinte = fn;
}

export function irParaSecao(secao: Secao): void {
  ouvinte?.(secao);
}
