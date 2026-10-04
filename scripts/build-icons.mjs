#!/usr/bin/env node
/**
 * Injeta o sprite de ícones (assets/icons.svg) dentro do index.html, entre os
 * marcadores `<!-- icons:start -->` e `<!-- icons:end -->`.
 *
 * O sprite é inline de propósito: `<use href="arquivo.svg#id">` externo não
 * funciona no Safari, e inline evita uma requisição a mais no primeiro paint.
 *
 * Para acrescentar um ícone: pegue o SVG em https://lucide.dev (licença ISC),
 * cole um <symbol id="i-nome" ...> em assets/icons.svg e rode `npm run icons`.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const INICIO = '<!-- icons:start -->';
const FIM = '<!-- icons:end -->';

const sprite = (await readFile(join(raiz, 'assets/icons.svg'), 'utf8')).trim();
const htmlPath = join(raiz, 'index.html');
const html = await readFile(htmlPath, 'utf8');

const de = html.indexOf(INICIO);
const ate = html.indexOf(FIM);
if (de === -1 || ate === -1) {
  console.error(`index.html nao tem os marcadores ${INICIO} ... ${FIM}`);
  process.exit(1);
}

const atualizado = html.slice(0, de + INICIO.length) + '\n' + sprite + '\n' + html.slice(ate);
await writeFile(htmlPath, atualizado, 'utf8');

const simbolos = (sprite.match(/<symbol /g) ?? []).length;
console.log(`${simbolos} icones inline em index.html (${sprite.length} bytes)`);

// Confere se algum <use href="#i-..."> aponta para simbolo inexistente.
const definidos = new Set([...sprite.matchAll(/id="(i-[^"]+)"/g)].map((m) => m[1]));
const usados = new Set(
  [...atualizado.matchAll(/href="#(i-[^"]+)"/g)].map((m) => m[1]),
);
const faltando = [...usados].filter((id) => !definidos.has(id));
const sobrando = [...definidos].filter((id) => !usados.has(id));

if (faltando.length) console.warn('FALTANDO no sprite:', faltando.join(', '));
if (sobrando.length) console.warn('sem uso no index.html (podem estar no TS):', sobrando.join(', '));
