/**
 * Avisos de mudança nos dados.
 *
 * Quem altera reservas ou status chama `dadosMudaram()`; quem exibe se inscreve
 * com `aoMudar()`. Evita que as views precisem importar umas às outras, o que
 * criaria ciclo entre mapa, reservas e administração.
 */

type Ouvinte = () => void;

const ouvintes = new Set<Ouvinte>();

export function aoMudar(ouvinte: Ouvinte): void {
  ouvintes.add(ouvinte);
}

export function dadosMudaram(): void {
  for (const ouvinte of ouvintes) {
    try {
      ouvinte();
    } catch (erro) {
      console.error('[CVGWeb] falha ao reagir a mudança de dados:', erro);
    }
  }
}
