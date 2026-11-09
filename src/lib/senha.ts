/**
 * Botão "ver senha".
 *
 * Genérico de propósito: o botão aponta para o input por `data-campo` (ou
 * `aria-controls`), então serve para qualquer campo de senha — entrada,
 * cadastro de usuário, troca de senha — sem código novo.
 *
 * Acessibilidade: o botão é `aria-pressed` e troca o rótulo entre "Mostrar
 * senha" e "Ocultar senha"; o leitor de tela anuncia o estado. O foco volta
 * para o campo com o cursor onde estava, para não atrapalhar quem digita.
 */
import { el } from './dom';

const ROTULO = { ver: 'Mostrar senha', ocultar: 'Ocultar senha' } as const;

function campoDoBotao(botao: HTMLElement): HTMLInputElement | null {
  const id = botao.dataset.campo ?? botao.getAttribute('aria-controls');

  return id ? el<HTMLInputElement>(id) : null;
}

function pintarBotao(botao: HTMLElement, visivel: boolean): void {
  const rotulo = visivel ? ROTULO.ocultar : ROTULO.ver;

  botao.setAttribute('aria-pressed', String(visivel));
  botao.setAttribute('aria-label', rotulo);
  botao.setAttribute('title', rotulo);

  // Um ícone por estado: olho aberto para revelar, olho cortado para ocultar.
  botao.querySelector('.senha__ic-ver')?.toggleAttribute('hidden', visivel);
  botao.querySelector('.senha__ic-ocultar')?.toggleAttribute('hidden', !visivel);
}

/** Alterna entre texto e pontinhos. Ligado em `data-action="alternar-senha"`. */
export function alternarVisibilidadeSenha(botao: HTMLElement): void {
  const campo = campoDoBotao(botao);
  if (!campo) return;

  const revelar = campo.type === 'password';
  const inicio = campo.selectionStart;
  const fim = campo.selectionEnd;

  campo.type = revelar ? 'text' : 'password';
  pintarBotao(botao, revelar);

  campo.focus();
  // Trocar o type zera a seleção em alguns navegadores: devolve o cursor.
  if (inicio !== null && fim !== null) {
    try {
      campo.setSelectionRange(inicio, fim);
    } catch {
      /* type=text nem sempre aceita seleção programática */
    }
  }
}

/** Volta o campo para oculto — use ao sair e ao limpar o formulário. */
export function esconderSenha(idDoCampo: string): void {
  const campo = el<HTMLInputElement>(idDoCampo);
  if (!campo || campo.type === 'password') return;

  campo.type = 'password';

  const botao = document.querySelector<HTMLElement>(
    `[data-action="alternar-senha"][data-campo="${idDoCampo}"]`,
  );
  if (botao) pintarBotao(botao, false);
}
