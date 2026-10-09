/**
 * Template de HTML com escape automático.
 *
 * Toda interpolação é escapada, por isso nome de projeto, nome de espaço ou
 * qualquer texto vindo da API não pode injetar marcação. Para inserir HTML
 * já montado de propósito, embrulhe em `raw()`.
 */

class Raw {
  constructor(readonly value: string) {}
}

/** Marca uma string como HTML confiável, isenta de escape. */
export function raw(value: string): Raw {
  return new Raw(value);
}

const ENTIDADES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapar(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (ch) => ENTIDADES[ch]);
}

export function html(
  strings: TemplateStringsArray,
  ...values: unknown[]
): string {
  let out = strings[0];
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    out += value instanceof Raw ? value.value : escapar(value);
    out += strings[i + 1];
  }
  return out;
}

/**
 * Junta pedaços de HTML já montados. O resultado serve direto para innerHTML;
 * para usar dentro de outro template, embrulhe em `raw()`.
 */
export function juntar(parts: string[]): string {
  return parts.join('');
}

/** `<svg><use href="#i-nome"></use></svg>` decorativo. */
export function icone(nome: string, classe = 'ic'): Raw {
  return raw(
    `<svg class="${escapar(classe)}" aria-hidden="true"><use href="#i-${escapar(nome)}"></use></svg>`,
  );
}
