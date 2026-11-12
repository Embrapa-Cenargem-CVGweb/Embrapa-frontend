/**
 * Posição de cada estufa sobre a foto aérea do campus (% relativo à imagem).
 *
 * `left`/`top` são o canto do alvo de clique antigo (2,6% × 3%), não o centro
 * do prédio: `pegada()` faz a conta e devolve o centro e o tamanho aproximado
 * do telhado, que é o que o marcador ocupa e o que o contorno de seleção
 * desenha.
 */
interface HotspotPos {
  id: string;
  left: number;   // %
  top: number;    // %
}

/** Retângulo do prédio na foto: centro e tamanho, em % da imagem. */
export interface Pegada {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

/** Metade do alvo antigo: leva do canto salvo ao centro do prédio. */
const MEIO = { x: 1.3, y: 1.5 };

/**
 * Tamanho do telhado por fileira. As estufas de uma mesma fileira têm quase a
 * mesma planta, então a medida sai da altura (`top`) em vez de 50 números.
 */
function tamanho(top: number): { w: number; h: number; dy: number } {
  if (top < 13) return { w: 2.9, h: 9.2, dy: 0 };      // a comprida do canto
  if (top < 25) return { w: 2.8, h: 6.6, dy: -0.4 };   // fileira de cima
  if (top < 40) return { w: 2.4, h: 6.8, dy: 0.4 };    // conjunto da direita
  if (top < 80) return { w: 2.7, h: 7.4, dy: 1.6 };    // fileira do meio
  return { w: 2.9, h: 9.0, dy: 0.6 };                  // fileira de baixo
}

export function pegada({ left, top }: HotspotPos): Pegada {
  const { w, h, dy } = tamanho(top);
  return { cx: left + MEIO.x, cy: top + MEIO.y + dy, w, h };
}

export const HOTSPOTS: HotspotPos[] = [
  { id: 'E01', left: 3.7, top: 10.9 },
  { id: 'E02', left: 7.8, top: 14.6 },
  { id: 'E03', left: 11.2, top: 15.5 },
  { id: 'E04', left: 14.5, top: 17.0 },
  { id: 'E05', left: 16.7, top: 17.0 },
  { id: 'E06', left: 23.5, top: 17.4 },
  { id: 'E07', left: 25.7, top: 17.0 },
  { id: 'E08', left: 29, top: 19.5 },
  { id: 'E09', left: 32.5, top: 19.5 },
  { id: 'E10', left: 35.8, top: 19.5 },
  { id: 'E11', left: 39.2, top: 19.5 },
  { id: 'E12', left: 42.8, top: 19.5 },
  { id: 'E13', left: 46.5, top: 19.5 },
  { id: 'E14', left: 48.7, top: 19.5 },
  { id: 'E15', left: 55.8, top: 19.0 },
  { id: 'E16', left: 58.1, top: 18.5 },
  { id: 'E17', left: 78.8, top: 29.5 },
  { id: 'E18', left: 82, top: 29.5 },
  { id: 'E19', left: 85.8, top: 29.8 },
  { id: 'E20', left: 89.3, top: 29.9 },
  { id: 'E21', left: 92.5, top: 31.9 },
  { id: 'E22', left: 24.8, top: 72.5 },
  { id: 'E23', left: 28.2, top: 72.5 },
  { id: 'E24', left: 31.6, top: 72.5 },
  { id: 'E25', left: 35.0, top: 72.5 },
  { id: 'E26', left: 38.5, top: 72.5 },
  { id: 'E27', left: 41.9, top: 72.5 },
  { id: 'E28', left: 45.3, top: 72.5 },
  { id: 'E29', left: 48.7, top: 72.5 },
  { id: 'E30', left: 52.7, top: 74.5 },
  { id: 'E31', left: 56.3, top: 74.5 },
  { id: 'E32', left: 60.1, top: 74.5 },
  { id: 'E33', left: 64.1, top: 74.5 },
  { id: 'E34', left: 69.9, top: 73.9 },
  { id: 'E35', left: 75.5, top: 73.9 },
  { id: 'E36', left: 17.9, top: 86.5 },
  { id: 'E37', left: 23.1, top: 86.5 },
  { id: 'E38', left: 28.5, top: 86.5 },
  { id: 'E39', left: 33.9, top: 86.5 },
  { id: 'E40', left: 39.1, top: 86.5 },
  { id: 'E41', left: 44.1, top: 88.7 },
  { id: 'E42', left: 47.6, top: 88.5 },
  { id: 'E43', left: 49.7, top: 86.5 },
  { id: 'E44', left: 53.7, top: 87.5 },
  { id: 'E45', left: 58.8, top: 87.5 },
  { id: 'E46', left: 60.9, top: 88.5 },
  { id: 'E47', left: 64.4, top: 88.5 },
  { id: 'E48', left: 68.0, top: 88.5 },
  { id: 'E49', left: 71.2, top: 89.9 },
  { id: 'E50', left: 74.9, top: 84.5 },
];
