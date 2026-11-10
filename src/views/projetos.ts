/**
 * Projetos, equipe e permissões.
 *
 * Esta é a tela onde o modelo de acesso do CVGWeb é configurado, e o desenho
 * segue o que o back-end cobra:
 *
 *   - criar e excluir projeto é do adm; editar depende de `projeto.editar`;
 *   - o responsável do projeto é o LÍDER da equipe, e os dois andam juntos:
 *     trocar o responsável troca o papel no vínculo;
 *   - ser líder NÃO dá CRUD. Sem concessão explícita do adm, só o adm faz CRUD
 *     em qualquer projeto. Por isso papel e permissões são dois passos
 *     separados aqui — juntá-los na mesma caixa sugeriria que um implica o
 *     outro;
 *   - as permissões valem por (pessoa × projeto): a mesma pessoa pode aprovar
 *     reserva num projeto e só criar no outro.
 *
 * Os checkboxes não são escritos à mão: vêm de `/permissoes/catalogo`, então
 * uma permissão nova no back aparece aqui sem mexer no front.
 */
import { el, qsa, setText, show } from '../lib/dom';
import { html, icone, juntar, raw } from '../lib/html';
import { dataBR } from '../lib/format';
import { abrirModal, confirmar, fecharModal, trocarModal } from '../lib/modal';
import { aviso } from '../lib/toast';
import {
  adicionarMembro,
  atualizarMembro,
  atualizarProjeto,
  criarProjeto,
  definirPermissoes,
  excluirProjeto,
  getCatalogoPermissoes,
  getEquipe,
  getProjetos,
  getStatusProjeto,
  removerMembro,
  type CatalogoPermissoes,
  type DadosProjeto,
  type MembroEquipe,
  type PapelEquipe,
  type PermissaoProjeto,
  type StatusProjetoApi,
} from '../services/api';
import { listarUsuarios, recarregarUsuarios, usuarioAtual } from './login';

/** Projeto como `/projetos` devolve. */
interface ProjetoApi {
  id: number;
  codigo: string;
  titulo: string;
  descricao?: string | null;
  data_inicio?: string | null;
  data_fim?: string | null;
  status_projeto_id?: number | null;
  funcionario_id?: number | null;
  status?: { id: number; descricao: string; encerrado?: boolean } | null;
  responsavel?: { id: number; nome: string } | null;
}

const PAPEL_ROTULO: Record<PapelEquipe, string> = {
  LIDER: 'Líder',
  PESQUISADOR: 'Pesquisador',
};

let projetos: ProjetoApi[] = [];
let statusProjeto: StatusProjetoApi[] = [];
let catalogo: CatalogoPermissoes | null = null;
let busca = '';

/** Projeto aberto na tela de equipe. */
let projetoAberto: ProjetoApi | null = null;
let equipe: MembroEquipe[] = [];
/** Projeto em edição no formulário; null = projeto novo. */
let projetoEmEdicao: ProjetoApi | null = null;
/** Membro aberto na tela de permissões. */
let membroAberto: MembroEquipe | null = null;

function ehAdmin(): boolean {
  return Boolean(usuarioAtual()?.admin);
}

function linhaVazia(colunas: number, nome: string, texto: string): string {
  return html`
    <tr class="table__empty">
      <td colspan="${colunas}">
        <div class="empty">
          ${icone(nome, 'ic ic--xl')}
          <p class="empty__text">${texto}</p>
        </div>
      </td>
    </tr>`;
}

function contar(id: string, mostrados: number, total: number, filtrando: boolean): void {
  setText(id, filtrando ? `${mostrados} de ${total}` : String(total));
}

function erroDe(erro: unknown, padrao: string): string {
  return erro instanceof Error ? erro.message : padrao;
}

/* ===========================================================================
   Lista de projetos
   =========================================================================== */

/** Entrada da seção de projetos: a casca chama ao mostrar a tela. */
export function mostrarProjetos(): void {
  if (!ehAdmin()) {
    aviso('Só a administração configura projetos.', 'error');
    return;
  }

  void carregarProjetos();
}

/** Lê projetos, status e catálogo de permissões. Os três alimentam esta tela. */
async function carregarProjetos(): Promise<void> {
  try {
    const [lista, status] = await Promise.all([getProjetos(), getStatusProjeto()]);
    projetos = (lista?.data ?? lista ?? []) as ProjetoApi[];
    statusProjeto = status;
  } catch (erro) {
    aviso(erroDe(erro, 'Não foi possível ler os projetos.'), 'error');
  }

  // Catálogo e lista de pessoas são usados pelos modais filhos; falhar aqui não
  // impede ver os projetos, então nenhum dos dois derruba a tela.
  if (!catalogo) {
    catalogo = await getCatalogoPermissoes().catch(() => null);
  }
  await recarregarUsuarios().catch(() => undefined);

  renderizarProjetos();
}

function renderizarProjetos(): void {
  const corpo = el('tbody-projetos');
  if (!corpo) return;

  const termo = busca.trim().toLowerCase();
  const linhas = projetos.filter(
    (p) =>
      !termo ||
      [p.codigo, p.titulo, p.responsavel?.nome, p.status?.descricao].some((campo) =>
        (campo ?? '').toLowerCase().includes(termo),
      ),
  );

  contar('conta-projetos', linhas.length, projetos.length, Boolean(termo));

  if (!linhas.length) {
    corpo.innerHTML = linhaVazia(
      6,
      'graduation-cap',
      termo
        ? `Nenhum projeto corresponde a “${busca}”.`
        : 'Nenhum projeto cadastrado. Comece criando o primeiro.',
    );
    return;
  }

  corpo.innerHTML = juntar(linhas.map(linhaDeProjeto));
}

function linhaDeProjeto(p: ProjetoApi): string {
  const vazio = html`<span class="table__muted">&mdash;</span>`;
  const encerrado = p.status?.encerrado ?? false;

  return html`
    <tr>
      <td data-label="Código"><span class="code">${p.codigo}</span></td>
      <td data-label="Projeto">
        <div class="table__stack">
          <span class="table__name">${p.titulo}</span>
          ${raw(p.descricao
            ? html`<span class="table__sub table__truncate">${p.descricao}</span>`
            : '')}
        </div>
      </td>
      <td data-label="Responsável">
        ${raw(p.responsavel
          ? html`<div class="table__stack">
                   <span>${p.responsavel.nome}</span>
                   <span class="table__sub">líder da equipe</span>
                 </div>`
          : vazio)}
      </td>
      <td data-label="Situação">
        ${raw(p.status
          ? html`<span class="pill ${raw(encerrado ? 'pill--down' : 'pill--ok')}">
                   ${icone(encerrado ? 'ban' : 'circle-check', 'ic ic--sm')}${p.status.descricao}
                 </span>`
          : vazio)}
      </td>
      <td data-label="Período" style="white-space:nowrap">
        ${raw(p.data_inicio || p.data_fim
          ? html`${p.data_inicio ? dataBR(p.data_inicio) : '—'} a
                 ${p.data_fim ? dataBR(p.data_fim) : 'sem fim'}`
          : vazio)}
      </td>
      <td data-label="Ações">
        <div class="table__actions">
          <button type="button" class="btn btn--quiet btn--sm"
                  data-action="abrir-equipe" data-id="${p.id}">
            ${icone('users', 'ic ic--sm')}Equipe e permissões
          </button>
          <button type="button" class="btn btn--quiet btn--sm btn--icon"
                  data-action="editar-projeto" data-id="${p.id}"
                  aria-label="Editar ${p.codigo}">
            ${icone('wrench', 'ic ic--sm')}
          </button>
          <button type="button" class="btn btn--danger btn--sm btn--icon"
                  data-action="excluir-projeto" data-id="${p.id}"
                  aria-label="Excluir ${p.codigo}">
            ${icone('trash-2', 'ic ic--sm')}
          </button>
        </div>
      </td>
    </tr>`;
}

export function buscarProjetos(termo: string): void {
  busca = termo;
  show(el('limpar-projetos'), Boolean(termo));
  renderizarProjetos();
}

export function limparBuscaDeProjetos(): void {
  const campo = el<HTMLInputElement>('busca-projetos');
  if (campo) campo.value = '';
  buscarProjetos('');
  campo?.focus();
}

/* ===========================================================================
   Cadastro do projeto
   =========================================================================== */

export function abrirNovoProjeto(): void {
  projetoEmEdicao = null;
  prepararFormulario();

  setText('proj-dialogo-titulo', 'Novo projeto');
  setText('proj-enviar-texto', 'Criar projeto');

  irParaFormulario();
}

export function abrirEditarProjeto(id: string): void {
  const projeto = projetos.find((p) => String(p.id) === id);
  if (!projeto) return;

  projetoEmEdicao = projeto;
  prepararFormulario();

  setText('proj-dialogo-titulo', `Editar ${projeto.codigo}`);
  setText('proj-enviar-texto', 'Salvar');

  definirValor('proj-codigo', projeto.codigo);
  definirValor('proj-titulo', projeto.titulo);
  definirValor('proj-descricao', projeto.descricao ?? '');
  definirValor('proj-inicio', projeto.data_inicio ?? '');
  definirValor('proj-fim', projeto.data_fim ?? '');
  definirValor('proj-status', String(projeto.status?.id ?? projeto.status_projeto_id ?? ''));
  definirValor('proj-responsavel', String(projeto.responsavel?.id ?? projeto.funcionario_id ?? ''));

  irParaFormulario();
}

/** A lista é tela, não modal: o formulário abre por cima dela. */
function irParaFormulario(): void {
  abrirModal('modal-projeto');
  el<HTMLInputElement>('proj-codigo')?.focus();
}

function prepararFormulario(): void {
  el<HTMLFormElement>('form-projeto')?.reset();
  mostrarErro(null);
  pintarStatus();
  pintarResponsaveis();
}

function pintarStatus(): void {
  const select = el<HTMLSelectElement>('proj-status');
  if (!select) return;

  select.innerHTML = juntar([
    html`<option value="">Selecione</option>`,
    ...statusProjeto.map((s) => html`<option value="${s.id}">${s.descricao}</option>`),
  ]);
}

/** Responsável sai da lista de usuários: quem não está cadastrado não lidera. */
function pintarResponsaveis(): void {
  const select = el<HTMLSelectElement>('proj-responsavel');
  if (!select) return;

  const pessoas = [...listarUsuarios()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  select.innerHTML = juntar([
    html`<option value="">Selecione</option>`,
    ...pessoas.map(
      (u) => html`<option value="${u.id}">${u.nome}${u.cargo ? ` — ${u.cargo}` : ''}</option>`,
    ),
  ]);
}

function definirValor(id: string, valor: string): void {
  const campo = el<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(id);
  if (campo) campo.value = valor;
}

function valorDe(id: string): string {
  return el<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(id)?.value.trim() ?? '';
}

function mostrarErro(mensagem: string | null): void {
  show(el('proj-erro'), Boolean(mensagem));
  setText('proj-erro-texto', mensagem ?? '');
}

export async function confirmarProjeto(): Promise<void> {
  const codigo = valorDe('proj-codigo');
  const titulo = valorDe('proj-titulo');
  const status = valorDe('proj-status');
  const responsavel = valorDe('proj-responsavel');
  const inicio = valorDe('proj-inicio');
  const fim = valorDe('proj-fim');

  if (!codigo || !titulo) {
    mostrarErro('Código e título são obrigatórios.');
    return;
  }

  if (!status || !responsavel) {
    mostrarErro('Escolha a situação e o pesquisador responsável.');
    return;
  }

  if (inicio && fim && fim < inicio) {
    mostrarErro('O fim do projeto não pode ser antes do início.');
    return;
  }

  const dados: DadosProjeto = {
    codigo,
    titulo,
    descricao: valorDe('proj-descricao') || null,
    data_inicio: inicio || null,
    data_fim: fim || null,
    status_projeto_id: Number(status),
    funcionario_id: Number(responsavel),
  };

  try {
    if (projetoEmEdicao) await atualizarProjeto(projetoEmEdicao.id, dados);
    else await criarProjeto(dados);
  } catch (erro) {
    mostrarErro(erroDe(erro, 'Não foi possível salvar o projeto.'));
    return;
  }

  const criado = !projetoEmEdicao;
  fecharModal(el('modal-projeto'));
  await carregarProjetos();

  aviso(criado ? `Projeto ${codigo} criado.` : `Projeto ${codigo} salvo.`, 'success');
}

export async function pedirExclusaoProjeto(id: string): Promise<void> {
  const projeto = projetos.find((p) => String(p.id) === id);
  if (!projeto) return;

  const ok = await confirmar({
    titulo: `Excluir ${projeto.codigo}?`,
    mensagem: html`O projeto <strong>${projeto.titulo}</strong> sai da lista, junto com a
      equipe e as permissões concedidas nele. As reservas já feitas e o histórico de
      auditoria permanecem.`,
    icone: 'trash-2',
    confirmar: 'Excluir',
    perigo: true,
  });

  if (!ok) return;

  try {
    await excluirProjeto(projeto.id);
  } catch (erro) {
    aviso(erroDe(erro, 'Não foi possível excluir o projeto.'), 'error');
    return;
  }

  await carregarProjetos();
  aviso(`Projeto ${projeto.codigo} excluído.`, 'info');
}

/* ===========================================================================
   Equipe do projeto
   =========================================================================== */

export function abrirEquipe(id: string): void {
  const projeto = projetos.find((p) => String(p.id) === id);
  if (!projeto) return;

  projetoAberto = projeto;
  equipe = [];

  setText('equipe-projeto-nome', `Equipe de ${projeto.codigo}`);
  setText('equipe-projeto-desc', projeto.titulo);

  abrirModal('modal-equipe');

  void carregarEquipe();
}

async function carregarEquipe(): Promise<void> {
  if (!projetoAberto) return;

  try {
    const resposta = await getEquipe(projetoAberto.id);
    equipe = resposta.equipe ?? [];
  } catch (erro) {
    aviso(erroDe(erro, 'Não foi possível ler a equipe.'), 'error');
    equipe = [];
  }

  renderizarEquipe();
}

function renderizarEquipe(): void {
  const corpo = el('tbody-equipe');
  if (!corpo) return;

  contar('conta-equipe', equipe.length, equipe.length, false);
  pintarCandidatos();

  if (!equipe.length) {
    corpo.innerHTML = linhaVazia(
      5,
      'users',
      'Ninguém na equipe ainda. Inclua o primeiro membro acima.',
    );
    return;
  }

  corpo.innerHTML = juntar(equipe.map(linhaDeMembro));
}

/**
 * Quem ainda pode entrar: todo mundo que está cadastrado e não está na equipe.
 * Filtrar aqui evita o 422 de "funcionário já está na equipe".
 */
function pintarCandidatos(): void {
  const select = el<HTMLSelectElement>('equipe-novo-membro');
  if (!select) return;

  const jaEstao = new Set(equipe.map((m) => m.id));
  const candidatos = [...listarUsuarios()]
    .filter((u) => !jaEstao.has(Number(u.id)))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  select.innerHTML = juntar([
    html`<option value="">${candidatos.length ? 'Selecione a pessoa' : 'Todos já estão na equipe'}</option>`,
    ...candidatos.map(
      (u) => html`<option value="${u.id}">${u.nome}${u.cargo ? ` — ${u.cargo}` : ''}</option>`,
    ),
  ]);
  select.disabled = candidatos.length === 0;
}

function linhaDeMembro(m: MembroEquipe): string {
  const vazio = html`<span class="table__muted">&mdash;</span>`;
  const quantas = m.permissoes.length;

  return html`
    <tr class="${raw(m.ativo ? '' : 'is-off')}">
      <td data-label="Membro">
        <div class="table__stack">
          <span class="table__name">
            ${m.nome}
            ${raw(m.lider ? html`<span class="pill pill--booked">líder</span>` : '')}
          </span>
          <span class="table__sub">${m.cargo ?? 'sem cargo'}${m.nick ? ` · ${m.nick}` : ''}</span>
        </div>
      </td>
      <td data-label="Papel">
        <select class="select select--sm" data-change="papel-membro" data-id="${m.id}"
                aria-label="Papel de ${m.nome} no projeto">
          ${raw(juntar(
            (Object.keys(PAPEL_ROTULO) as PapelEquipe[]).map(
              (papel) => html`<option value="${papel}" ${raw(m.papel === papel ? 'selected' : '')}>
                                ${PAPEL_ROTULO[papel]}
                              </option>`,
            ),
          ))}
        </select>
      </td>
      <td data-label="Função">${raw(m.funcao ? html`${m.funcao}` : vazio)}</td>
      <td data-label="Permissões">
        ${raw(quantas
          ? html`<span class="pill pill--ok">
                   ${icone('shield-check', 'ic ic--sm')}${String(quantas)}
                   ${quantas === 1 ? 'permissão' : 'permissões'}
                 </span>`
          : html`<span class="pill pill--neutral">
                   ${icone('ban', 'ic ic--sm')}só leitura
                 </span>`)}
      </td>
      <td data-label="Ações">
        <div class="table__actions">
          <button type="button" class="btn btn--quiet btn--sm"
                  data-action="abrir-permissoes" data-id="${m.id}">
            ${icone('shield-user', 'ic ic--sm')}Permissões
          </button>
          <button type="button" class="btn btn--danger btn--sm btn--icon"
                  data-action="remover-membro" data-id="${m.id}"
                  aria-label="Remover ${m.nome} da equipe">
            ${icone('user-x', 'ic ic--sm')}
          </button>
        </div>
      </td>
    </tr>`;
}

export async function incluirMembro(): Promise<void> {
  if (!projetoAberto) return;

  const funcionario = valorDe('equipe-novo-membro');
  if (!funcionario) {
    aviso('Escolha quem entra na equipe.', 'error');
    return;
  }

  const papel = (valorDe('equipe-novo-papel') || 'PESQUISADOR') as PapelEquipe;
  const funcao = valorDe('equipe-nova-funcao');

  try {
    // Entra sem permissão nenhuma: conceder é o passo seguinte, explícito.
    await adicionarMembro(projetoAberto.id, {
      funcionario_id: Number(funcionario),
      papel,
      funcao: funcao || null,
    });
  } catch (erro) {
    aviso(erroDe(erro, 'Não foi possível incluir o membro.'), 'error');
    return;
  }

  definirValor('equipe-nova-funcao', '');
  await carregarEquipe();
  // Trocar o líder muda o responsável do projeto; a lista precisa reler.
  if (papel === 'LIDER') await carregarProjetos();

  aviso('Membro incluído. Conceda as permissões em “Permissões”.', 'success');
}

export async function alterarPapelMembro(id: string, papel: string): Promise<void> {
  if (!projetoAberto) return;

  const membro = equipe.find((m) => String(m.id) === id);
  if (!membro) return;

  try {
    await atualizarMembro(projetoAberto.id, membro.id, { papel: papel as PapelEquipe });
  } catch (erro) {
    aviso(erroDe(erro, 'Não foi possível trocar o papel.'), 'error');
    renderizarEquipe();
    return;
  }

  await carregarEquipe();
  // O líder do projeto é o responsável: a lista de projetos muda com ele.
  await carregarProjetos();

  aviso(
    papel === 'LIDER'
      ? `${membro.nome} agora lidera ${projetoAberto.codigo}. Ser líder não concede CRUD.`
      : `${membro.nome} agora é pesquisador em ${projetoAberto.codigo}.`,
    'info',
  );
}

export async function removerMembroDaEquipe(id: string): Promise<void> {
  if (!projetoAberto) return;

  const membro = equipe.find((m) => String(m.id) === id);
  if (!membro) return;

  const ok = await confirmar({
    titulo: `Remover ${membro.nome}?`,
    mensagem: html`Sai da equipe de <strong>${projetoAberto.codigo}</strong> e perde as
      permissões que tinha neste projeto. O cadastro da pessoa e o acesso ao sistema
      continuam.`,
    icone: 'user-x',
    confirmar: 'Remover',
    perigo: true,
  });

  if (!ok) return;

  try {
    await removerMembro(projetoAberto.id, membro.id);
  } catch (erro) {
    aviso(erroDe(erro, 'Não foi possível remover o membro.'), 'error');
    return;
  }

  await carregarEquipe();
  aviso(`${membro.nome} saiu da equipe.`, 'info');
}

export function voltarParaProjetos(): void {
  fecharModal(el('modal-equipe'));
}

/* ===========================================================================
   Permissões do membro

   Quem concede é só o adm (o back cobra isso em `gerenciarPermissoes`). A tela
   mostra o catálogo agrupado como ele vem da API e marca o que o membro já tem.
   =========================================================================== */

export function abrirPermissoesMembro(id: string): void {
  const membro = equipe.find((m) => String(m.id) === id);
  if (!membro || !projetoAberto) return;

  membroAberto = membro;

  setText('perm-titulo', `Permissões de ${membro.nome}`);
  setText(
    'perm-desc',
    `Valem só em ${projetoAberto.codigo}. Sem marcar nada, a pessoa apenas consulta.`,
  );

  pintarPermissoes(membro.permissoes);
  trocarModal('modal-equipe', 'modal-permissoes');
}

function pintarPermissoes(marcadas: PermissaoProjeto[]): void {
  const alvo = el('perm-grupos');
  if (!alvo) return;

  if (!catalogo) {
    alvo.innerHTML = html`
      <div class="empty">
        ${icone('circle-x', 'ic ic--xl')}
        <p class="empty__text">O catálogo de permissões não carregou. Feche e abra de novo.</p>
      </div>`;
    return;
  }

  const tem = new Set(marcadas);

  alvo.innerHTML = juntar(
    Object.entries(catalogo.grupos).map(
      ([chaveGrupo, grupo]) => html`
        <fieldset class="fieldset">
          <legend class="fieldset__legend">${grupo.titulo}</legend>
          ${raw(juntar(
            grupo.itens.map(
              (item) => html`
                <label class="perm" for="perm-${chaveGrupo}-${item.chave}">
                  <input class="perm__check" type="checkbox"
                         id="perm-${chaveGrupo}-${item.chave}"
                         value="${item.chave}" ${raw(tem.has(item.chave) ? 'checked' : '')} />
                  <span class="perm__texto">
                    <span class="perm__rotulo">${item.rotulo}</span>
                    <span class="perm__desc">${item.descricao}</span>
                  </span>
                </label>`,
            ),
          ))}
        </fieldset>`,
    ),
  );
}

/** Marca o conjunto que o adm costuma dar para aquele papel. Só sugestão. */
export function sugerirPermissoesDoPapel(): void {
  if (!membroAberto || !catalogo) return;

  const papel: PapelEquipe = membroAberto.papel ?? 'PESQUISADOR';
  const sugestao = catalogo.sugestoes[papel] ?? [];

  pintarPermissoes(sugestao);
  aviso(`Marcado o conjunto típico de ${PAPEL_ROTULO[papel].toLowerCase()}. Revise e salve.`, 'info');
}

export async function salvarPermissoes(): Promise<void> {
  if (!membroAberto || !projetoAberto) return;

  const marcadas = qsa<HTMLInputElement>('#perm-grupos input[type="checkbox"]')
    .filter((caixa) => caixa.checked)
    .map((caixa) => caixa.value as PermissaoProjeto);

  try {
    await definirPermissoes(projetoAberto.id, membroAberto.id, marcadas);
  } catch (erro) {
    aviso(erroDe(erro, 'Não foi possível salvar as permissões.'), 'error');
    return;
  }

  const nome = membroAberto.nome;
  trocarModal('modal-permissoes', 'modal-equipe');
  await carregarEquipe();

  aviso(
    marcadas.length
      ? `${nome}: ${marcadas.length} ${marcadas.length === 1 ? 'permissão' : 'permissões'} em ${projetoAberto.codigo}.`
      : `${nome} ficou sem permissão de CRUD em ${projetoAberto.codigo}.`,
    'success',
  );
}

export function voltarParaEquipe(): void {
  trocarModal('modal-permissoes', 'modal-equipe');
}
