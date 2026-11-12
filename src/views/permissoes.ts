/**
 * Modal "Permissões", aberto pelo cabeçalho da tela de usuários.
 *
 * Mostra, para a pessoa escolhida, tudo o que ela pode fazer num lugar só:
 *  - Em todo o sistema: permissões especiais que valem em qualquer projeto
 *    (aprovar reservas, configurar estufas, ver os logs…);
 *  - Por projeto: as de cada projeto em que ela está na equipe.
 *
 * Só a administração concede. O cargo é só informação — não dá permissão.
 */
import { el, qsa, show } from '../lib/dom';
import { html, icone, juntar, raw } from '../lib/html';
import { abrirModal } from '../lib/modal';
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

/** O botão do cabeçalho só aparece para a administração. */
export function mostrarBotaoDePermissoes(): void {
  show(el('btn-permissoes-usuarios'), Boolean(usuarioAtual()?.admin));
}

export async function abrirPermissoesDeUsuarios(id?: string): Promise<void> {
  const select = el<HTMLSelectElement>('perm-pessoa');
  if (!select) return;

  const pessoas = [...listarUsuarios()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  select.innerHTML = juntar([
    html`<option value="" disabled>Escolha a pessoa</option>`,
    ...pessoas.map((u) => html`<option value="${u.id}">${u.nome}${u.cargo ? ` — ${u.cargo}` : ''}${u.situacao === 'INATIVO' ? ' (desativado)' : ''}</option>`),
  ]);
  select.value = id ?? '';
  select.onchange = () => void carregar(select.value);

  atual = null;
  pintar();
  abrirModal('modal-permissoes');
  select.focus();

  catalogo ??= await getCatalogoPermissoes().catch(() => null);
  if (select.value) await carregar(select.value);
}

async function carregar(id: string): Promise<void> {
  const conteudo = el('perm-conteudo');
  if (conteudo) conteudo.innerHTML = html`<p class="empty__text">Lendo as permissões&hellip;</p>`;

  try {
    atual = await getPermissoesDaPessoa(Number(id));
  } catch (erro) {
    atual = null;
    aviso(erro instanceof Error ? erro.message : 'Não foi possível ler as permissões.', 'error');
  }
  pintar();
}

function caixa(grupo: string, chave: string, rotulo: string, descricao: string, marcada: boolean): string {
  const id = `perm-${grupo}-${chave.replace(/\W/g, '-')}`;
  return html`
    <label class="perm" for="${id}">
      <input class="perm__check" type="checkbox" id="${id}" value="${chave}" ${raw(marcada ? 'checked' : '')} />
      <span class="perm__texto">
        <span class="perm__rotulo">${rotulo}</span>
        <span class="perm__desc">${descricao}</span>
      </span>
    </label>`;
}

function pintar(): void {
  const conteudo = el('perm-conteudo');
  if (!conteudo) return;

  if (!atual) {
    conteudo.innerHTML = html`<p class="empty__text">Escolha uma pessoa para ver e mudar o que ela pode fazer.</p>`;
    return;
  }

  if (atual.administrador) {
    conteudo.innerHTML = html`
      <p class="field__aviso">
        ${icone('shield-user', 'ic ic--sm')}
        ${atual.funcionario.nome} tem o cargo Administrador: já pode tudo, em todo o sistema.
      </p>`;
    return;
  }

  const globais = new Set(atual.globais);
  const sistema = html`
    <section class="perm-bloco" aria-labelledby="perm-sistema-titulo">
      <div class="perm-bloco__topo">
        <div>
          <h3 class="perm-bloco__titulo" id="perm-sistema-titulo">Em todo o sistema</h3>
          <p class="perm-bloco__desc">Valem em qualquer projeto, mesmo nos que a pessoa não participa.</p>
        </div>
        <button type="button" class="btn btn--primary btn--sm" data-action="salvar-perm-sistema">
          ${icone('save', 'ic ic--sm')}Salvar
        </button>
      </div>
      <div class="perm-grade" id="perm-sistema">
        ${raw(juntar(atual.catalogo_global.map((p) => caixa('sistema', p.chave, p.rotulo, p.descricao, globais.has(p.chave)))))}
      </div>
    </section>`;

  const projetos = atual.projetos.length
    ? juntar(atual.projetos.map((p) => {
      const tem = new Set(p.permissoes);
      const grupos = catalogo
        ? Object.entries(catalogo.grupos).map(([g, grupo]) => html`
            <fieldset class="fieldset">
              <legend class="fieldset__legend">${grupo.titulo}</legend>
              ${raw(juntar(grupo.itens.map((item) => caixa(`p${p.id}-${g}`, item.chave, item.rotulo, item.descricao, tem.has(item.chave)))))}
            </fieldset>`)
        : [html`<p class="empty__text">O catálogo de permissões não carregou. Feche e abra de novo.</p>`];

      return html`
        <section class="perm-bloco" aria-label="Permissões em ${p.titulo}">
          <div class="perm-bloco__topo">
            <div>
              <h3 class="perm-bloco__titulo">${p.titulo}</h3>
              <p class="perm-bloco__desc">${p.papel === 'LIDER' ? 'Líder do projeto' : 'Participa do projeto'} · vale só aqui.</p>
            </div>
            <button type="button" class="btn btn--quiet btn--sm" data-action="salvar-perm-projeto" data-projeto="${p.id}">
              ${icone('save', 'ic ic--sm')}Salvar neste projeto
            </button>
          </div>
          <div class="perm-grade form-cols" id="perm-projeto-${p.id}">${raw(juntar(grupos))}</div>
        </section>`;
    }))
    : html`<p class="empty__text">${atual.funcionario.nome} ainda não está em nenhum projeto. Convide pela tela de Projetos.</p>`;

  conteudo.innerHTML = juntar([
    sistema,
    html`<h3 class="perm-secao">Por projeto</h3>`,
    projetos,
  ]);
}

function marcadas(containerId: string): PermissaoProjeto[] {
  return qsa<HTMLInputElement>(`#${containerId} input[type="checkbox"]`)
    .filter((c) => c.checked)
    .map((c) => c.value as PermissaoProjeto);
}

export async function salvarPermissoesDoSistema(): Promise<void> {
  if (!atual) return;
  try {
    await salvarPermissoesDeSistema(atual.funcionario.id, marcadas('perm-sistema'));
    aviso(`Permissões de sistema de ${atual.funcionario.nome} salvas.`, 'success');
    await carregar(String(atual.funcionario.id));
  } catch (erro) {
    aviso(erro instanceof Error ? erro.message : 'Não foi possível salvar.', 'error');
  }
}

export async function salvarPermissoesDoProjeto(projetoId: number): Promise<void> {
  if (!atual) return;
  const projeto = atual.projetos.find((p) => p.id === projetoId);
  try {
    await definirPermissoes(projetoId, atual.funcionario.id, marcadas(`perm-projeto-${projetoId}`));
    aviso(`Permissões de ${atual.funcionario.nome} em ${projeto?.titulo ?? 'projeto'} salvas.`, 'success');
    await carregar(String(atual.funcionario.id));
  } catch (erro) {
    aviso(erro instanceof Error ? erro.message : 'Não foi possível salvar.', 'error');
  }
}
