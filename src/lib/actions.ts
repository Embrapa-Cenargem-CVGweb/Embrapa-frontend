/**
 * Delegação de eventos.
 *
 * Nada de `onclick` no HTML e nada em `window`: cada controle declara o que faz
 * com `data-action`, e um único listener no documento encaminha para a função
 * registrada. Views registram as próprias ações no boot.
 */

type Acao = (elemento: HTMLElement, evento: Event) => void;

const acoes = new Map<string, Acao>();

export function registrarAcoes(mapa: Record<string, Acao>): void {
  for (const [nome, fn] of Object.entries(mapa)) {
    if (acoes.has(nome)) console.warn(`[CVGWeb] ação duplicada: ${nome}`);
    acoes.set(nome, fn);
  }
}

export function iniciarAcoes(): void {
  document.addEventListener('click', (evento) => {
    const alvo = evento.target;
    if (!(alvo instanceof Element)) return;

    const gatilho = alvo.closest<HTMLElement>('[data-action]');
    if (!gatilho) return;

    const nome = gatilho.dataset.action;
    if (!nome) return;

    const fn = acoes.get(nome);
    if (!fn) {
      console.warn(`[CVGWeb] ação sem handler: ${nome}`);
      return;
    }

    fn(gatilho, evento);
  });
}
