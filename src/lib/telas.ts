/**
 * Peças que as telas de gestão (reservas, projetos, usuários, espaços e logs)
 * têm em comum: a faixa de números do topo e o avatar com as iniciais.
 */
import { html, icone, juntar, raw } from './html';

export interface Stat {
  /** Nome do símbolo no sprite, sem o prefixo `i-`. */
  icone: string;
  numero: number | string;
  rotulo: string;
  /** Tom do quadradinho do ícone; sem ele, neutro. */
  tom?: 'ok' | 'busy' | 'booked' | 'down';
}

/** Desenha a faixa de números dentro do contêiner `id`. */
export function pintarStats(id: string, itens: Stat[]): void {
  const alvo = document.getElementById(id);
  if (!alvo) return;

  alvo.innerHTML = juntar(itens.map((item) => html`
    <div class="stat" data-tone="${item.tom ?? ''}">
      <span class="stat__tile">${icone(item.icone)}</span>
      <div>
        <div class="stat__num">${String(item.numero)}</div>
        <div class="stat__label">${item.rotulo}</div>
      </div>
    </div>`));
}

/** "Ana Paula Souza" vira "AS": primeira letra do primeiro e do último nome. */
export function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return '?';
  const letras = partes.length === 1
    ? partes[0].slice(0, 2)
    : partes[0][0] + partes[partes.length - 1][0];
  return letras.toUpperCase();
}

/** Bolinha com as iniciais. Decorativa: o nome vem escrito ao lado. */
export function avatar(nome: string): ReturnType<typeof raw> {
  return raw(html`<span class="av" aria-hidden="true">${iniciais(nome)}</span>`);
}
