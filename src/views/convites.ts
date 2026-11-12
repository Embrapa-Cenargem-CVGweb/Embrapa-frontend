/**
 * Convites para projetos.
 *
 * Dois modais na tela de Projetos:
 *  - "Convidar": quem está no projeto (líder, adm ou quem tem
 *    equipe.adicionar) escolhe pessoas e manda o convite;
 *  - "Convites": o botão do cabeçalho. Recebidos (aceitar/recusar) e
 *    enviados (situação de cada um, cancelar enquanto não respondido).
 *
 * Quem aceita entra na equipe só acompanhando: o que pode fazer é concedido
 * depois, em Equipe e permissões.
 */
import { el, qsa, setText, show } from '../lib/dom';
import { html, icone, juntar, raw } from '../lib/html';
import { dataHoraBR } from '../lib/format';
import { avatar } from '../lib/telas';
import { abrirModal, fecharModal } from '../lib/modal';
import { aviso } from '../lib/toast';
import {
  aceitarConvite,
  cancelarConvite,
  convidarParaProjeto,
  getConvites,
  getEquipe,
  getPessoasOpcoes,
  recusarConvite,
  type ConviteProjetoApi,
  type ConvitesApi,
  type PessoaOpcao,
} from '../services/api';
import { contextoAtual, recarregarContexto } from '../data/contexto';
import { usuarioAtual } from './login';
import { carregarProjetos } from './projetos';

/* ===========================================================================
   Contador do botão "Convites"
   =========================================================================== */

/** Quantos convites esperam a resposta da pessoa (vem do /me/contexto). */
export function pintarContadorDeConvites(total = contextoAtual()?.convites_pendentes ?? 0): void {
  for (const id of ['conta-convites', 'conta-convites-recebidos']) {
    const badge = el(id);
    if (!badge) continue;
    badge.textContent = String(total);
    show(badge, total > 0);
  }
}

/* ===========================================================================
   Convidar pessoas para um projeto
   =========================================================================== */

let projetoDoConvite: { id: number; titulo: string } | null = null;
let pessoas: PessoaOpcao[] = [];
/** Quem já está na equipe do projeto aberto: aparece, mas não dá para escolher. */
let naEquipe = new Set<number>();
let escolhidos: number[] = [];
let enviando = false;

export function abrirConvidar(projetoId: number, titulo: string): void {
  projetoDoConvite = { id: projetoId, titulo };
  escolhidos = [];
  naEquipe = new Set();

  setText('convidar-projeto', titulo);
  const busca = el<HTMLInputElement>('convidar-busca');
  if (busca) busca.value = '';
  const mensagem = el<HTMLTextAreaElement>('convidar-mensagem');
  if (mensagem) mensagem.value = '';
  mostrarErro(null);
  pintarConvidar();

  abrirModal('modal-convidar');
  busca?.focus();

  ligarCampos();

  // Pessoas e equipe chegam por trás; a lista se repinta quando chegarem.
  void Promise.all([
    pessoas.length ? Promise.resolve(pessoas) : getPessoasOpcoes(),
    getEquipe(projetoId).catch(() => null),
  ])
    .then(([lista, equipe]) => {
      pessoas = lista;
      naEquipe = new Set((equipe?.equipe ?? []).map((m) => m.id));
      pintarConvidar();
    })
    .catch(() => mostrarErro('Não foi possível ler a lista de pessoas.'));
}

/** Os ouvintes do modal são ligados uma vez; atribuir de novo não duplica. */
function ligarCampos(): void {
  const busca = el<HTMLInputElement>('convidar-busca');
  if (busca) busca.oninput = () => pintarConvidar();

  const lista = el('convidar-pessoas');
  if (lista) {
    lista.onclick = (ev) => {
      const botao = (ev.target as Element).closest<HTMLElement>('[data-escolher]');
      if (!botao) return;
      const id = Number(botao.dataset.escolher);
      if (!escolhidos.includes(id)) escolhidos.push(id);
      pintarConvidar();
      el<HTMLInputElement>('convidar-busca')?.focus();
    };
  }

  const escolhidosLista = el('convidar-escolhidos');
  if (escolhidosLista) {
    escolhidosLista.onclick = (ev) => {
      const botao = (ev.target as Element).closest<HTMLElement>('[data-tirar]');
      if (!botao) return;
      escolhidos = escolhidos.filter((id) => id !== Number(botao.dataset.tirar));
      pintarConvidar();
    };
  }
}

function normalizar(texto: string): string {
  return texto.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function pintarConvidar(): void {
  const lista = el('convidar-pessoas');
  const escolhidosLista = el('convidar-escolhidos');
  if (!lista || !escolhidosLista) return;

  const eu = Number(usuarioAtual()?.id);
  const termo = normalizar(el<HTMLInputElement>('convidar-busca')?.value ?? '');

  // Sem digitar nada, a lista mostra as primeiras pessoas; digitando, filtra.
  const achadas = pessoas
    .filter((p) => p.id !== eu && !escolhidos.includes(p.id))
    .filter((p) => !termo || normalizar(`${p.nome} ${p.cargo ?? ''}`).includes(termo))
    .slice(0, 30);

  if (!pessoas.length) {
    lista.innerHTML = html`<li class="opcoes-pessoas__vazio">Lendo as pessoas&hellip;</li>`;
  } else if (!achadas.length) {
    lista.innerHTML = html`<li class="opcoes-pessoas__vazio">Ninguém encontrado com esse nome.</li>`;
  } else {
    lista.innerHTML = juntar(achadas.map((p) => html`
      <li class="opcoes-pessoas__item">
        ${avatar(p.nome)}
        <span class="opcoes-pessoas__nome">${p.nome}<small>${p.cargo ?? 'sem cargo'}${naEquipe.has(p.id) ? ' · já está na equipe' : ''}</small></span>
        ${raw(naEquipe.has(p.id)
          ? html`<span class="pill pill--neutral">Na equipe</span>`
          : html`<button type="button" class="btn btn--quiet btn--sm" data-escolher="${p.id}"
                         aria-label="Adicionar ${p.nome} ao convite">Adicionar</button>`)}
      </li>`));
  }

  escolhidosLista.innerHTML = juntar(escolhidos.map((id) => {
    const p = pessoas.find((x) => x.id === id);
    const nome = p?.nome ?? `Pessoa ${id}`;
    return html`
      <li class="pessoas__item">
        ${nome}${raw(p?.cargo ? html`<span class="pessoas__cargo">· ${p.cargo}</span>` : '')}
        <button type="button" class="pessoas__remover" data-tirar="${id}" aria-label="Tirar ${nome} do convite">
          ${icone('x', 'ic ic--sm')}
        </button>
      </li>`;
  }));

  show(el('convidar-nenhum'), escolhidos.length === 0);
  setText(
    'convidar-enviar-texto',
    escolhidos.length > 1 ? `Enviar ${escolhidos.length} convites` : 'Enviar convite',
  );
}

function mostrarErro(mensagem: string | null): void {
  show(el('convidar-erro'), Boolean(mensagem));
  setText('convidar-erro-texto', mensagem ?? '');
}

export async function enviarConvites(): Promise<void> {
  if (!projetoDoConvite || enviando) return;

  if (!escolhidos.length) {
    mostrarErro('Escolha pelo menos uma pessoa.');
    el<HTMLInputElement>('convidar-busca')?.focus();
    return;
  }

  const botao = el<HTMLButtonElement>('convidar-enviar');
  enviando = true;
  if (botao) botao.disabled = true;

  try {
    const mensagem = (el<HTMLTextAreaElement>('convidar-mensagem')?.value ?? '').trim();
    const resposta = await convidarParaProjeto(projetoDoConvite.id, escolhidos, mensagem || null);
    fecharModal(el('modal-convidar'));
    aviso(resposta.message, 'success');
  } catch (erro) {
    mostrarErro(erro instanceof Error ? erro.message : 'Não foi possível enviar os convites.');
  } finally {
    enviando = false;
    if (botao) botao.disabled = false;
  }
}

/* ===========================================================================
   Modal "Convites": recebidos e enviados
   =========================================================================== */

let convites: ConvitesApi | null = null;

export function abrirConvites(): void {
  trocarAba(convites && !convites.recebidos.length && convites.enviados.length ? 'enviados' : 'recebidos');
  pintarConvites();
  abrirModal('modal-convites');
  void lerConvites();
}

export function trocarAba(nova: 'recebidos' | 'enviados'): void {
  for (const chip of qsa('[data-action="aba-convites"]')) {
    chip.setAttribute('aria-checked', String(chip.dataset.aba === nova));
  }
  show(el('convites-recebidos'), nova === 'recebidos');
  show(el('convites-enviados'), nova === 'enviados');
}

async function lerConvites(): Promise<void> {
  try {
    convites = await getConvites();
    pintarContadorDeConvites(convites.recebidos.length);
  } catch (erro) {
    aviso(erro instanceof Error ? erro.message : 'Não foi possível ler os convites.', 'error');
  }
  pintarConvites();
}

const STATUS: Record<ConviteProjetoApi['status'], { rotulo: string; tom: string }> = {
  PENDENTE: { rotulo: 'Aguardando resposta', tom: 'pill--busy' },
  ACEITO: { rotulo: 'Aceito', tom: 'pill--ok' },
  RECUSADO: { rotulo: 'Recusado', tom: 'pill--neutral' },
  CANCELADO: { rotulo: 'Cancelado', tom: 'pill--neutral' },
};

function pintarConvites(): void {
  const recebidos = el('convites-recebidos');
  const enviados = el('convites-enviados');
  if (!recebidos || !enviados) return;

  if (!convites) {
    const lendo = html`<p class="empty__text">Lendo os convites&hellip;</p>`;
    recebidos.innerHTML = lendo;
    enviados.innerHTML = lendo;
    return;
  }

  recebidos.innerHTML = convites.recebidos.length
    ? juntar(convites.recebidos.map(cartaoRecebido))
    : vazio('Nenhum convite esperando você.');

  enviados.innerHTML = convites.enviados.length
    ? juntar(convites.enviados.map(linhaEnviado))
    : vazio('Você ainda não convidou ninguém. Use “Convidar” no cartão de um projeto seu.');
}

function vazio(texto: string): string {
  return html`
    <div class="empty">
      ${icone('send-horizontal', 'ic ic--xl')}
      <p class="empty__text">${texto}</p>
    </div>`;
}

function cartaoRecebido(c: ConviteProjetoApi): string {
  const quem = c.autor?.nome ?? 'A administração';
  return html`
    <article class="convite" aria-label="Convite para ${c.projeto?.titulo ?? 'projeto'}">
      <div class="convite__topo">
        ${avatar(quem)}
        <div class="convite__texto">
          <span><strong>${quem}</strong>${c.autor?.cargo ? ` (${c.autor.cargo})` : ''} convidou você para</span>
          <span class="convite__projeto">${c.projeto?.titulo ?? '—'}</span>
          ${raw(c.projeto?.descricao ? html`<span>${c.projeto.descricao}</span>` : '')}
        </div>
        ${raw(c.criado_em ? html`<span class="convite__quando">${dataHoraBR(c.criado_em)}</span>` : '')}
      </div>
      ${raw(c.mensagem ? html`<p class="convite__mensagem">“${c.mensagem}”</p>` : '')}
      <div class="convite__acoes">
        <button type="button" class="btn btn--quiet btn--sm" data-action="recusar-convite" data-id="${c.id}">
          Recusar
        </button>
        <button type="button" class="btn btn--primary btn--sm" data-action="aceitar-convite" data-id="${c.id}">
          ${icone('circle-check', 'ic ic--sm')}Aceitar e entrar na equipe
        </button>
      </div>
    </article>`;
}

function linhaEnviado(c: ConviteProjetoApi): string {
  const status = STATUS[c.status];
  return html`
    <article class="convite convite--enviado">
      <div class="convite__texto">
        <span><strong>${c.convidado?.nome ?? '—'}</strong>${c.convidado?.cargo ? ` · ${c.convidado.cargo}` : ''}</span>
        <span>${c.projeto?.titulo ?? '—'}</span>
      </div>
      <span class="pill ${raw(status.tom)}">${status.rotulo}</span>
      ${raw(c.status === 'PENDENTE'
        ? html`<button type="button" class="btn btn--quiet btn--sm" data-action="cancelar-convite" data-id="${c.id}">
                 Cancelar convite
               </button>`
        : '')}
    </article>`;
}

/** Depois de responder, a equipe e as permissões da pessoa mudam: relê tudo. */
async function depoisDeResponder(): Promise<void> {
  await lerConvites();
  const contexto = await recarregarContexto();
  pintarContadorDeConvites(contexto?.convites_pendentes ?? convites?.recebidos.length ?? 0);
  await carregarProjetos();
}

export async function responderConvite(id: number, resposta: 'aceitar' | 'recusar'): Promise<void> {
  try {
    const r = resposta === 'aceitar' ? await aceitarConvite(id) : await recusarConvite(id);
    aviso(r.message, resposta === 'aceitar' ? 'success' : 'info');
  } catch (erro) {
    aviso(erro instanceof Error ? erro.message : 'Não foi possível responder o convite.', 'error');
  }
  await depoisDeResponder();
}

export async function desistirDoConvite(id: number): Promise<void> {
  try {
    const r = await cancelarConvite(id);
    aviso(r.message, 'info');
  } catch (erro) {
    aviso(erro instanceof Error ? erro.message : 'Não foi possível cancelar o convite.', 'error');
  }
  await lerConvites();
}
