/**
 * Modal "Permissões", aberto pelo cabeçalho da tela de usuários.
 *
 * Mostra, para a pessoa escolhida, tudo o que ela pode fazer num lugar só:
 *  - Em todo o sistema: permissões especiais que valem em qualquer projeto
 *    (aprovar reservas, configurar estufas, ver os logs…);
 *  - Por projeto: as de cada projeto em que ela está na equipe, cada um numa
 *    sanfona que abre e fecha.
 *
 * Cada permissão é uma chave liga/desliga. Nada grava sozinho: o que foi
 * mexido fica marcado, o rodapé conta as alterações e um único "Salvar" manda
 * tudo — antes havia um botão de salvar por bloco, e era fácil mexer em dois
 * projetos e gravar só um.
 *
 * Só a administração concede. O cargo é só informação — não dá permissão.
 */
import { el, qs, qsa, setText, show } from '../lib/dom';
import { html, icone, juntar, raw } from '../lib/html';
import { abrirModal, confirmar } from '../lib/modal';
import { iniciais } from '../lib/telas';
import { aviso } from '../lib/toast';
import {
  definirPermissoes,
  getCatalogoPermissoes,
  getPermissoesDaPessoa,
  salvarPermissoesDeSistema,
  type CatalogoPermissoes,
  type PermissaoProjeto,
  type PermissoesDaPessoa,
} from '../services/api';
import { listarUsuarios, usuarioAtual } from './login';

let catalogo: CatalogoPermissoes | null = null;
let atual: PermissoesDaPessoa | null = null;
/** Pessoa escolhida no seletor (para voltar a ela se a troca for cancelada). */
let pessoaEscolhida = '';
let salvando = false;
let ligado = false;

/** O botão do cabeçalho só aparece para a administração. */
export function mostrarBotaoDePermissoes(): void {
  show(el('btn-permissoes-usuarios'), Boolean(usuarioAtual()?.admin));
}

export async function abrirPermissoesDeUsuarios(id?: string): Promise<void> {
  const select = el<HTMLSelectElement>('perm-pessoa');
  if (!select) return;

  ligar();

  const pessoas = [...listarUsuarios()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  select.innerHTML = juntar([
    html`<option value="" disabled>Escolha a pessoa</option>`,
    ...pessoas.map((u) => html`<option value="${u.id}">${u.nome}${u.cargo ? ` — ${u.cargo}` : ''}${u.situacao === 'INATIVO' ? ' (desativado)' : ''}</option>`),
  ]);
  select.value = id ?? '';
  pessoaEscolhida = select.value;

  atual = null;
  pintar();
  abrirModal('modal-permissoes');
  select.focus();

  catalogo ??= await getCatalogoPermissoes().catch(() => null);
  if (select.value) await carregar(select.value);
}

function ligar(): void {
  if (ligado) return;
  ligado = true;

  const select = el<HTMLSelectElement>('perm-pessoa');
  select?.addEventListener('change', () => void trocarDePessoa(select));
  el('perm-conteudo')?.addEventListener('change', atualizarEstado);
}

/** Trocar de pessoa com alteração pendente pede confirmação: o que não foi salvo se perde. */
async function trocarDePessoa(select: HTMLSelectElement): Promise<void> {
  if (alteracoes() > 0) {
    const ok = await confirmar({
      titulo: 'Descartar as alterações?',
      mensagem: html`Você mexeu nas permissões de <strong>${atual?.funcionario.nome ?? 'esta pessoa'}</strong> e ainda não salvou.`,
      confirmar: 'Descartar',
      cancelar: 'Continuar editando',
      perigo: true,
    });
    if (!ok) {
      select.value = pessoaEscolhida;
      return;
    }
  }

  pessoaEscolhida = select.value;
  await carregar(select.value);
}

async function carregar(id: string): Promise<void> {
  const conteudo = el('perm-conteudo');
  if (conteudo) conteudo.innerHTML = html`<div class="pm-vazio">${icone('clock', 'ic ic--xl')}<p>Lendo as permissões&hellip;</p></div>`;

  try {
    atual = await getPermissoesDaPessoa(Number(id));
  } catch (erro) {
    atual = null;
    aviso(erro instanceof Error ? erro.message : 'Não foi possível ler as permissões.', 'error');
  }
  pintar();
}

/* ===========================================================================
   Pintura
   =========================================================================== */

/** Uma permissão: texto à esquerda, chave liga/desliga à direita. */
function item(grupo: string, chave: string, rotulo: string, descricao: string, marcada: boolean): string {
  const id = `perm-${grupo}-${chave.replace(/\W/g, '-')}`;
  return html`
    <label class="pm-item" for="${id}">
      <span class="pm-item__texto">
        <span class="pm-item__rotulo">${rotulo}</span>
        <span class="pm-item__desc">${descricao}</span>
      </span>
      <input class="pm-switch" type="checkbox" role="switch" id="${id}" value="${chave}"
             data-original="${marcada ? '1' : '0'}" ${raw(marcada ? 'checked' : '')} />
    </label>`;
}

/** Cabeçalho da pessoa: iniciais, cargo e um resumo do que ela já tem. */
function pintarPessoa(): void {
  const avatar = el('perm-av');
  const selos = el('perm-selos');
  const usuario = listarUsuarios().find((u) => String(u.id) === pessoaEscolhida);

  if (avatar) {
    avatar.textContent = usuario ? iniciais(usuario.nome) : '?';
    avatar.toggleAttribute('data-vazio', !usuario);
  }
  if (!selos) return;

  if (!usuario || !atual) {
    selos.innerHTML = '';
    return;
  }

  selos.innerHTML = juntar([
    atual.administrador
      ? html`<span class="pill pill--booked">${icone('shield-user', 'ic ic--sm')}Administrador</span>`
      : html`<span class="pill pill--neutral">${atual.funcionario.cargo ?? usuario.cargo ?? 'Sem cargo'}</span>`,
    usuario.situacao === 'INATIVO' ? html`<span class="pill pill--down">Acesso desativado</span>` : '',
  ]);
}

function pintar(): void {
  const conteudo = el('perm-conteudo');
  if (!conteudo) return;

  pintarPessoa();

  if (!atual) {
    conteudo.innerHTML = html`
      <div class="pm-vazio">
        ${icone('shield-user', 'ic ic--xl')}
        <p>Escolha uma pessoa para ver e mudar o que ela pode fazer.</p>
      </div>`;
    atualizarEstado();
    return;
  }

  if (atual.administrador) {
    conteudo.innerHTML = html`
      <div class="pm-vazio pm-vazio--adm">
        ${icone('shield-check', 'ic ic--xl')}
        <p><strong>${atual.funcionario.nome}</strong> tem o cargo Administrador.</p>
        <p>Já pode tudo, em todo o sistema — não há o que marcar aqui.</p>
      </div>`;
    atualizarEstado();
    return;
  }

  const globais = new Set(atual.globais);
  const sistema = html`
    <section class="pm-bloco" aria-labelledby="perm-sistema-titulo">
      <header class="pm-bloco__topo">
        <span class="pm-bloco__icone" data-tom="sistema" aria-hidden="true">${icone('shield-check')}</span>
        <div class="pm-bloco__titulos">
          <h3 class="pm-bloco__titulo" id="perm-sistema-titulo">Em todo o sistema</h3>
          <p class="pm-bloco__desc">Valem em qualquer projeto, mesmo nos que a pessoa não participa.</p>
        </div>
        <span class="pm-conta" data-conta="perm-sistema"></span>
      </header>
      <div class="pm-lista" id="perm-sistema">
        ${raw(juntar(atual.catalogo_global.map((p) => item('sistema', p.chave, p.rotulo, p.descricao, globais.has(p.chave)))))}
      </div>
    </section>`;

  const umSo = atual.projetos.length === 1;
  const projetos = atual.projetos.length
    ? juntar(atual.projetos.map((p) => {
      const tem = new Set(p.permissoes);
      const grupos = catalogo
        ? Object.entries(catalogo.grupos).map(([g, grupo]) => html`
            <div class="pm-grupo">
              <h4 class="pm-grupo__titulo">${grupo.titulo}</h4>
              <div class="pm-lista">
                ${raw(juntar(grupo.itens.map((i) => item(`p${p.id}-${g}`, i.chave, i.rotulo, i.descricao, tem.has(i.chave)))))}
              </div>
            </div>`)
        : [html`<p class="pm-grupo__titulo">O catálogo de permissões não carregou. Feche e abra de novo.</p>`];

      return html`
        <details class="pm-bloco pm-projeto" ${raw(umSo ? 'open' : '')}>
          <summary class="pm-bloco__topo">
            <span class="pm-bloco__icone" aria-hidden="true">${icone('graduation-cap')}</span>
            <div class="pm-bloco__titulos">
              <h3 class="pm-bloco__titulo">${p.titulo}</h3>
              <p class="pm-bloco__desc">
                <span class="pm-codigo">${p.codigo}</span>
                ${p.papel === 'LIDER' ? 'Líder do projeto' : 'Participa do projeto'} · vale só aqui
              </p>
            </div>
            <span class="pm-conta" data-conta="perm-projeto-${p.id}"></span>
            <span class="pm-seta" aria-hidden="true">${icone('chevron-right', 'ic ic--sm')}</span>
          </summary>
          <div class="pm-projeto__corpo" id="perm-projeto-${p.id}" data-projeto="${p.id}">${raw(juntar(grupos))}</div>
        </details>`;
    }))
    : html`
      <div class="pm-vazio pm-vazio--linha">
        ${icone('graduation-cap', 'ic')}
        <p>${atual.funcionario.nome} ainda não está em nenhum projeto. Convide pela tela de Projetos.</p>
      </div>`;

  conteudo.innerHTML = juntar([
    sistema,
    html`<h3 class="pm-secao">Por projeto <span class="count">${String(atual.projetos.length)}</span></h3>`,
    projetos,
  ]);

  atualizarEstado();
}

/* ===========================================================================
   O que mudou
   =========================================================================== */

function chaves(containerId: string): HTMLInputElement[] {
  return qsa<HTMLInputElement>(`#${containerId} input[type="checkbox"]`);
}

function mudou(c: HTMLInputElement): boolean {
  return c.checked !== (c.dataset.original === '1');
}

/** Quantas chaves estão diferentes do que está gravado. */
function alteracoes(containerId?: string): number {
  const todas = containerId ? chaves(containerId) : qsa<HTMLInputElement>('#perm-conteudo input[type="checkbox"]');
  return todas.filter(mudou).length;
}

/** Contadores "3 de 6", destaque do que foi mexido e o rodapé com o salvar. */
function atualizarEstado(): void {
  for (const c of qsa<HTMLInputElement>('#perm-conteudo input[type="checkbox"]')) {
    c.closest('.pm-item')?.toggleAttribute('data-mudou', mudou(c));
  }

  for (const conta of qsa('[data-conta]')) {
    const id = conta.dataset.conta ?? '';
    const todas = chaves(id);
    const ligadas = todas.filter((c) => c.checked).length;
    conta.textContent = `${ligadas} de ${todas.length}`;
    conta.toggleAttribute('data-alguma', ligadas > 0);
    conta.toggleAttribute('data-mudou', alteracoes(id) > 0);
  }

  const n = alteracoes();
  const botao = el<HTMLButtonElement>('perm-salvar');
  if (botao) botao.disabled = n === 0 || salvando;
  setText(
    'perm-estado',
    n === 0 ? '' : n === 1 ? '1 alteração não salva' : `${n} alterações não salvas`,
  );
}

function marcadas(containerId: string): PermissaoProjeto[] {
  return chaves(containerId).filter((c) => c.checked).map((c) => c.value as PermissaoProjeto);
}

/* ===========================================================================
   Salvar
   =========================================================================== */

/** Grava tudo o que foi mexido: o bloco do sistema e cada projeto alterado. */
export async function salvarPermissoes(): Promise<void> {
  if (!atual || salvando || alteracoes() === 0) return;

  const pessoa = atual.funcionario;
  salvando = true;
  atualizarEstado();

  try {
    if (alteracoes('perm-sistema') > 0) {
      await salvarPermissoesDeSistema(pessoa.id, marcadas('perm-sistema'));
    }
    for (const bloco of qsa('.pm-projeto__corpo')) {
      if (alteracoes(bloco.id) === 0) continue;
      await definirPermissoes(Number(bloco.dataset.projeto), pessoa.id, marcadas(bloco.id));
    }
  } catch (erro) {
    salvando = false;
    atualizarEstado();
    aviso(erro instanceof Error ? erro.message : 'Não foi possível salvar as permissões.', 'error');
    return;
  }

  salvando = false;

  // Relê do servidor, mantendo abertas as sanfonas que estavam abertas.
  const abertas = new Set(qsa<HTMLDetailsElement>('.pm-projeto[open]').map((d) => qs('.pm-projeto__corpo', d)?.id ?? ''));
  await carregar(String(pessoa.id));
  for (const d of qsa<HTMLDetailsElement>('.pm-projeto')) {
    if (abertas.has(qs('.pm-projeto__corpo', d)?.id ?? '')) d.open = true;
  }

  aviso(`Permissões de ${pessoa.nome} salvas.`, 'success');
}
