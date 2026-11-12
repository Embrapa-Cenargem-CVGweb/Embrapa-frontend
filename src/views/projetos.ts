/**
 * Projetos, equipe e permissões.
 *
 * Esta é a tela onde o modelo de acesso do CVGWeb é configurado, e o desenho
 * segue o que o back-end cobra:
 *
 *   - qualquer pesquisador ativo PROPÕE um projeto, e ele nasce PENDENTE: só
 *     passa a valer quando a administração aprova. Excluir continua sendo do
 *     adm; editar depende de `projeto.editar` — ou de ser o autor de uma
 *     proposta que ainda não foi aceita;
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
import { avatar, pintarStats } from '../lib/telas';
import { abrirModal, confirmar, fecharModal } from '../lib/modal';
import { aviso } from '../lib/toast';
import {
  adicionarMembro,
  aprovarProjeto,
  atualizarMembro,
  atualizarProjeto,
  criarProjeto,
  excluirProjeto,
  getCatalogoPermissoes,
  getEquipe,
  getProjetoDetalhe,
  getPessoasOpcoes,
  getProjetos,
  getStatusProjeto,
  recusarProjeto,
  removerMembro,
  type CatalogoPermissoes,
  type DadosProjeto,
  type MembroEquipe,
  type PapelEquipe,
  type PessoaOpcao,
  type ProjetoDetalhe,
  type SituacaoProjeto,
  type StatusProjetoApi,
} from '../services/api';
import { listarUsuarios, recarregarUsuarios, usuarioAtual } from './login';
import { pode, recarregarContexto } from '../data/contexto';

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
  /** Quem está na equipe (id e nome), para os avatares do cartão. */
  colaboradores?: { id: number; nome: string }[];
  colaboradores_count?: number;
  /** Situação da proposta. Ausente em resposta antiga: trata-se como aprovada. */
  situacao?: SituacaoProjeto;
  motivo_recusa?: string | null;
  aprovador?: { id: number; nome: string } | null;
  /** A pessoa logada está na equipe (ou é a autora). Todos veem todos os projetos. */
  participo?: boolean;
  sou_lider?: boolean;
  /** Pode chamar gente para a equipe (líder, adm, equipe.adicionar). */
  posso_convidar?: boolean;
  /** O líder está com o acesso ativo. Falso só em dado antigo: hoje desativar exige passar a liderança. */
  lider_ativo?: boolean;
}

/** Projeto de outra pessoa: dá para ver, não para mexer. O adm mexe em todos. */
function deFora(p: ProjetoApi): boolean {
  return !ehAdmin() && p.participo === false;
}

/** Proposta ainda não decidida pela administração. */
function estaPendente(p: ProjetoApi): boolean {
  return p.situacao === 'PENDENTE';
}

/** Quem pode mexer no projeto: o adm, ou o autor enquanto a proposta espera. */
function souODono(p: ProjetoApi): boolean {
  const eu = usuarioAtual();
  return Boolean(eu && String(p.responsavel?.id ?? p.funcionario_id ?? '') === String(eu.id));
}

const PAPEL_ROTULO: Record<PapelEquipe, string> = {
  LIDER: 'Líder',
  PESQUISADOR: 'Pesquisador',
};

let projetos: ProjetoApi[] = [];
let statusProjeto: StatusProjetoApi[] = [];
let catalogo: CatalogoPermissoes | null = null;
let busca = '';
/** Recorte da lista: todos, os meus (participo) ou os de outras pessoas. */
type FiltroProjetos = 'todos' | 'meus' | 'outros';
let filtroProjetos: FiltroProjetos = 'todos';

const TITULO_FILTRO: Record<FiltroProjetos, string> = {
  todos: 'Todos',
  meus: 'Meus projetos',
  outros: 'De outras pessoas',
};

export function filtrarProjetos(filtro: FiltroProjetos): void {
  filtroProjetos = filtro;
  for (const chip of qsa('[data-action="filtrar-projetos"]')) {
    chip.setAttribute('aria-checked', String(chip.dataset.filtro === filtro));
  }
  setText('titulo-filtro-projetos', TITULO_FILTRO[filtro]);
  renderizarProjetos();
}

/** Projeto aberto na tela de equipe. */
let projetoAberto: ProjetoApi | null = null;
let equipe: MembroEquipe[] = [];
/** Equipe aberta de um projeto de outra pessoa: só para ver. */
let equipeSoLeitura = false;
/** Projeto em edição no formulário; null = projeto novo. */
let projetoEmEdicao: ProjetoApi | null = null;

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
  // A lista é de todo mundo: o back-end devolve ao pesquisador só os projetos
  // em que ele está (e as propostas dele), e sem esta tela ele não teria como
  // saber qual projeto informar na hora de reservar.
  //
  // Volta à tela: mostra na hora o que já foi lido e atualiza por trás, em vez
  // de deixar a tela vazia esperando a rede.
  // O botão diz o mesmo que o modal que ele abre.
  setText('btn-novo-projeto-texto', ehAdmin() ? 'Novo projeto' : 'Propor projeto');

  if (jaLeuProjetos) renderizarProjetos();
  else pintarLendoProjetos();
  void carregarProjetos();
}

/** Já houve uma leitura de projetos nesta sessão (a lista em memória vale). */
let jaLeuProjetos = false;

function pintarLendoProjetos(): void {
  const lista = el('lista-projetos');
  if (!lista || lista.children.length) return;
  lista.innerHTML = html`
    <div class="empty">
      ${icone('clock', 'ic ic--xl')}
      <p class="empty__text">Lendo os projetos&hellip;</p>
    </div>`;
}

/**
 * Lê projetos e status (a lista) e, em paralelo, catálogo de permissões e
 * pessoas (os modais). A lista é desenhada assim que chega, sem esperar os
 * outros; quem chama com `await` (depois de salvar algo) recebe tudo pronto.
 * Também serve de pré-carga logo depois do login.
 */
export async function carregarProjetos(): Promise<void> {
  // Falhar aqui não impede ver os projetos: nenhum dos dois derruba a tela.
  const auxiliares = Promise.all([
    catalogo ? null : getCatalogoPermissoes().then((c) => { catalogo = c; }).catch(() => undefined),
    recarregarUsuarios().catch(() => undefined),
  ]);

  try {
    const [lista, status] = await Promise.all([getProjetos(), getStatusProjeto()]);
    projetos = (lista?.data ?? lista ?? []) as ProjetoApi[];
    statusProjeto = status;
    jaLeuProjetos = true;
  } catch (erro) {
    aviso(erroDe(erro, 'Não foi possível ler os projetos.'), 'error');
  }

  renderizarProjetos();
  await auxiliares;
}

function renderizarProjetos(): void {
  const lista = el('lista-projetos');
  if (!lista) return;

  const termo = busca.trim().toLowerCase();
  const doFiltro = projetos.filter((p) =>
    filtroProjetos === 'todos' || (filtroProjetos === 'meus' ? !deFora(p) : deFora(p)));
  const visiveis = doFiltro.filter(
    (p) =>
      !termo ||
      [p.codigo, p.titulo, p.responsavel?.nome, p.status?.descricao].some((campo) =>
        (campo ?? '').toLowerCase().includes(termo),
      ),
  );

  contar('conta-projetos', visiveis.length, doFiltro.length, Boolean(termo));

  if (!visiveis.length) {
    lista.innerHTML = html`
      <div class="empty">
        ${icone('graduation-cap', 'ic ic--xl')}
        <p class="empty__text">${termo
          ? `Nenhum projeto corresponde a “${busca}”.`
          : filtroProjetos === 'meus'
            ? 'Você ainda não participa de nenhum projeto. Proponha um ou aceite um convite.'
            : filtroProjetos === 'outros'
              ? 'Nenhum projeto de outras pessoas por enquanto.'
              : 'Nenhum projeto cadastrado. Comece criando o primeiro.'}</p>
      </div>`;
    return;
  }

  lista.innerHTML = juntar(visiveis.map(cartaoDeProjeto));
}

/** Quantos avatares da equipe o cartão mostra antes do "+N". */
const AVATARES_NO_CARTAO = 4;

/**
 * Um projeto por cartão: situação, código, título, líder, período e a equipe.
 * As ações são as mesmas que a tabela antiga tinha na última coluna.
 */
/**
 * A etiqueta do topo. A situação da proposta fala mais alto que o andamento da
 * pesquisa: de nada adianta ler "Em andamento" num projeto que ainda não foi
 * aprovado.
 */
function selo(p: ProjetoApi, encerrado: boolean): string {
  if (estaPendente(p)) {
    return html`<span class="pill pill--booked">
      ${icone('clock', 'ic ic--sm')}Aguardando aprovação
    </span>`;
  }

  if (p.situacao === 'RECUSADO') {
    return html`<span class="pill pill--down">${icone('ban', 'ic ic--sm')}Recusado</span>`;
  }

  if (!p.status) {
    return html`<span class="pill pill--neutral">Sem situação</span>`;
  }

  return html`<span class="pill ${raw(encerrado ? 'pill--down' : 'pill--ok')}">
    ${icone(encerrado ? 'ban' : 'circle-check', 'ic ic--sm')}${p.status.descricao}
  </span>`;
}

function cartaoDeProjeto(p: ProjetoApi): string {
  const encerrado = p.status?.encerrado ?? false;
  const equipe = p.colaboradores ?? [];
  const total = p.colaboradores_count ?? equipe.length;
  const resto = total - Math.min(equipe.length, AVATARES_NO_CARTAO);

  const periodo = p.data_inicio || p.data_fim
    ? `${p.data_inicio ? dataBR(p.data_inicio) : '—'} a ${p.data_fim ? dataBR(p.data_fim) : 'sem fim'}`
    : 'Sem período definido';

  const alheio = deFora(p);
  const semLider = ehAdmin() && p.lider_ativo === false
    ? html`<span class="pill pill--down">${icone('ban', 'ic ic--sm')}Sem líder ativo</span>`
    : '';
  const meuPapel = alheio
    ? html`<span class="pill pill--neutral">${icone('eye', 'ic ic--sm')}Só leitura</span>`
    : p.sou_lider
      ? html`<span class="pill pill--booked">Você é líder</span>`
      : p.participo
        ? html`<span class="pill pill--neutral">Você participa</span>`
        : '';

  return html`
    <article class="pcard pcard--clicavel ${raw(alheio ? 'pcard--alheio' : '')}" aria-label="Projeto ${p.titulo}"
             data-projeto="${p.id}" title="Clique para ver a ficha do projeto">
      <div class="pcard__top">
        <span class="pcard__tile">${icone('graduation-cap')}</span>
        <span class="pcard__selos">${raw(selo(p, encerrado))}${raw(semLider)}${raw(meuPapel)}</span>
      </div>

      ${raw(p.situacao === 'RECUSADO' && p.motivo_recusa
        ? html`<p class="pcard__aviso">Recusado: ${p.motivo_recusa}</p>`
        : '')}
      ${raw(estaPendente(p)
        ? html`<p class="pcard__aviso">Aguardando a administração. Não aceita reserva até ser aprovado.</p>`
        : '')}

      <div>
        <span class="code">${p.codigo}</span>
        <h3 class="pcard__title">
          <button type="button" class="pcard__abrir" data-action="ver-projeto" data-id="${p.id}"
                  aria-label="Ver a ficha de ${p.titulo}">${p.titulo}</button>
        </h3>
        ${raw(p.descricao ? html`<p class="pcard__desc">${p.descricao}</p>` : '')}
        <div class="pcard__meta">
          <span>${p.responsavel ? `Líder: ${p.responsavel.nome}` : 'Sem líder definido'}</span>
          <span>${periodo}</span>
        </div>
      </div>

      <div class="pcard__team">
        <span class="av-stack">
          ${raw(juntar(equipe.slice(0, AVATARES_NO_CARTAO).map((m) => html`${avatar(m.nome)}`)))}
          ${raw(resto > 0 ? html`<span class="av" aria-hidden="true">+${String(resto)}</span>` : '')}
        </span>
        <span>${String(total)} ${total === 1 ? 'pessoa na equipe' : 'pessoas na equipe'}</span>
      </div>

      <div class="pcard__actions">
        ${raw(estaPendente(p) && pode('aprovar_projeto')
          ? html`
            <button type="button" class="btn btn--primary btn--sm"
                    data-action="aprovar-projeto" data-id="${p.id}">
              ${icone('circle-check', 'ic ic--sm')}Aprovar
            </button>
            <button type="button" class="btn btn--quiet btn--sm"
                    data-action="recusar-projeto" data-id="${p.id}">
              ${icone('ban', 'ic ic--sm')}Recusar
            </button>`
          : html`
            ${raw(p.posso_convidar
              ? html`<button type="button" class="btn btn--primary btn--sm"
                             data-action="abrir-convidar" data-id="${p.id}" data-titulo="${p.titulo}">
                       ${icone('user-plus', 'ic ic--sm')}Convidar
                     </button>`
              : '')}
            ${raw(alheio
              ? html`<button type="button" class="btn btn--quiet btn--sm"
                             data-action="ver-projeto" data-id="${p.id}">
                       ${icone('eye', 'ic ic--sm')}Ver projeto
                     </button>`
              : html`<button type="button" class="btn btn--quiet btn--sm"
                             data-action="abrir-equipe" data-id="${p.id}">
                       ${icone('users', 'ic ic--sm')}Equipe
                     </button>`)}`)}

        ${raw(ehAdmin() || souODono(p)
          ? html`<button type="button" class="btn btn--quiet btn--sm btn--icon"
                         data-action="editar-projeto" data-id="${p.id}"
                         aria-label="Editar ${p.codigo}">
                   ${icone('wrench', 'ic ic--sm')}
                 </button>`
          : '')}

        ${raw(ehAdmin()
          ? html`<button type="button" class="btn btn--danger btn--sm btn--icon"
                         data-action="excluir-projeto" data-id="${p.id}"
                         aria-label="Excluir ${p.codigo}">
                   ${icone('trash-2', 'ic ic--sm')}
                 </button>`
          : '')}
      </div>
    </article>`;
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

/** Pessoas que podem entrar como participantes (lidas na 1ª abertura). */
let pessoasOpcoes: PessoaOpcao[] = [];
/** Participantes escolhidos no formulário de projeto novo. */
let participantes: number[] = [];

export function abrirNovoProjeto(): void {
  projetoEmEdicao = null;
  prepararFormulario();
  prepararParticipantes();

  // Pesquisador propõe; administração cria direto. A palavra muda porque o
  // resultado muda: a proposta dele ainda vai esperar o aval de alguém.
  setText('proj-dialogo-titulo', ehAdmin() ? 'Novo projeto' : 'Propor projeto');
  setText('proj-enviar-texto', ehAdmin() ? 'Criar projeto' : 'Enviar proposta');
  show(el('proj-aviso-proposta'), !ehAdmin());

  irParaFormulario();
}

export function abrirEditarProjeto(id: string): void {
  const projeto = projetos.find((p) => String(p.id) === id);
  if (!projeto) return;

  projetoEmEdicao = projeto;
  prepararFormulario();

  setText('proj-dialogo-titulo', `Editar ${projeto.titulo}`);
  setText('proj-enviar-texto', 'Salvar');

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
  el<HTMLInputElement>('proj-titulo')?.focus();
}

function prepararFormulario(): void {
  el<HTMLFormElement>('form-projeto')?.reset();
  mostrarErro(null);
  pintarStatus();
  pintarResponsaveis();

  // Situação e responsável são decisão da administração: na proposta, o autor
  // é o responsável e o status inicial vem do back-end.
  show(el('proj-status')?.closest('.field') ?? null, ehAdmin());
  show(el('proj-responsavel')?.closest('.field') ?? null, ehAdmin());

  // Participantes só na criação; depois, a equipe é mexida em "Equipe".
  participantes = [];
  show(el('proj-participantes-campo'), false);
}

/* ---------------------------------------------------------------------------
   Participantes do projeto novo
   --------------------------------------------------------------------------- */

function prepararParticipantes(): void {
  show(el('proj-participantes-campo'), true);
  pintarParticipantes();

  const select = el<HTMLSelectElement>('proj-participante');
  if (select) {
    select.onchange = () => {
      const id = Number(select.value);
      if (id && !participantes.includes(id)) participantes.push(id);
      pintarParticipantes();
      select.focus();
    };
  }

  // Trocar o responsável (adm) tira ele dos participantes: ele já é o líder.
  const responsavel = el<HTMLSelectElement>('proj-responsavel');
  if (responsavel) responsavel.onchange = () => pintarParticipantes();

  const lista = el('proj-participantes');
  if (lista) {
    lista.onclick = (ev) => {
      const botao = (ev.target as Element).closest<HTMLElement>('[data-remover-participante]');
      if (!botao) return;
      participantes = participantes.filter((id) => id !== Number(botao.dataset.removerParticipante));
      pintarParticipantes();
      el<HTMLSelectElement>('proj-participante')?.focus();
    };
  }

  // A lista de pessoas é lida uma vez e reaproveitada; chega por trás.
  if (!pessoasOpcoes.length) {
    void getPessoasOpcoes()
      .then((lista) => {
        pessoasOpcoes = lista;
        pintarParticipantes();
      })
      .catch(() => undefined);
  }
}

function pintarParticipantes(): void {
  const select = el<HTMLSelectElement>('proj-participante');
  const lista = el('proj-participantes');
  if (!select || !lista) return;

  // Quem cria já entra como líder: não aparece como participante.
  const responsavel = ehAdmin() ? Number(valorDe('proj-responsavel')) : Number(usuarioAtual()?.id);
  participantes = participantes.filter((id) => id !== responsavel);

  const disponiveis = pessoasOpcoes.filter((p) => p.id !== responsavel && !participantes.includes(p.id));

  select.innerHTML = juntar([
    html`<option value="">${pessoasOpcoes.length ? 'Adicionar pessoa…' : 'Lendo as pessoas…'}</option>`,
    ...disponiveis.map(
      (p) => html`<option value="${p.id}">${p.nome}${p.cargo ? ` — ${p.cargo}` : ''}</option>`,
    ),
  ]);
  select.value = '';

  lista.innerHTML = juntar(
    participantes.map((id) => {
      const pessoa = pessoasOpcoes.find((p) => p.id === id);
      const nome = pessoa?.nome ?? `Pessoa ${id}`;
      return html`
        <li class="pessoas__item">
          ${nome}${raw(pessoa?.cargo ? html`<span class="pessoas__cargo">· ${pessoa.cargo}</span>` : '')}
          <button type="button" class="pessoas__remover" data-remover-participante="${id}"
                  aria-label="Tirar ${nome} dos participantes">
            ${icone('x', 'ic ic--sm')}
          </button>
        </li>`;
    }),
  );
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
  const titulo = valorDe('proj-titulo');
  const descricao = valorDe('proj-descricao');
  const status = valorDe('proj-status');
  const responsavel = valorDe('proj-responsavel');
  const inicio = valorDe('proj-inicio');
  const fim = valorDe('proj-fim');

  if (!titulo || !descricao) {
    mostrarErro('Informe o nome do projeto e o que ele vai fazer.');
    (titulo ? el('proj-descricao') : el('proj-titulo'))?.focus();
    return;
  }

  if (ehAdmin() && (!status || !responsavel)) {
    mostrarErro('Escolha a situação e o pesquisador responsável.');
    return;
  }

  if (inicio && fim && fim < inicio) {
    mostrarErro('O fim do projeto não pode ser antes do início.');
    return;
  }

  const dados: DadosProjeto = {
    titulo,
    descricao,
    data_inicio: inicio || null,
    data_fim: fim || null,
    // Em branco só acontece na proposta: o back-end usa o status inicial e
    // põe quem propôs como responsável.
    status_projeto_id: status ? Number(status) : null,
    funcionario_id: responsavel ? Number(responsavel) : null,
    // Só na criação: na edição a equipe é mexida em "Equipe e permissões".
    ...(projetoEmEdicao ? {} : { colaboradores: [...participantes] }),
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
  await recarregarContexto();

  if (!criado) {
    aviso(`Projeto ${titulo} salvo.`, 'success');
  } else if (ehAdmin()) {
    aviso(`Projeto ${titulo} criado.`, 'success');
  } else {
    aviso(`Proposta ${titulo} enviada. A administração vai avaliar.`, 'success');
  }
}

/* ===========================================================================
   Decisão da administração sobre a proposta
   =========================================================================== */

/**
 * Aprovar passa o projeto a valer e concede ao autor o mínimo para tocá-lo
 * (quem aprova decide isso no back-end). Como as permissões da pessoa logada
 * podem ter mudado, o contexto é relido na sequência.
 */
export async function decidirProjeto(id: string): Promise<void> {
  const projeto = projetos.find((p) => String(p.id) === id);
  if (!projeto) return;

  const ok = await confirmar({
    titulo: `Aprovar ${projeto.codigo}?`,
    mensagem: html`
      <strong>${projeto.titulo}</strong> passa a valer e aceita reservas.
      ${projeto.responsavel ? `${projeto.responsavel.nome} fica como líder` : 'O autor fica como líder'}
      e recebe as permissões básicas do próprio projeto: criar, editar e
      cancelar reserva, editar o projeto e incluir gente na equipe.`,
    confirmar: 'Aprovar',
    icone: 'circle-check',
  });
  if (!ok) return;

  try {
    await aprovarProjeto(projeto.id);
  } catch (erro) {
    aviso(erroDe(erro, 'Não foi possível aprovar o projeto.'), 'error');
    return;
  }

  await carregarProjetos();
  await recarregarContexto();
  aviso(`Projeto ${projeto.codigo} aprovado.`, 'success');
}

/** Recusar exige dizer por quê: o autor precisa saber o que corrigir. */
export async function recusarProjetoAberto(id: string): Promise<void> {
  const projeto = projetos.find((p) => String(p.id) === id);
  if (!projeto) return;

  // O diálogo é montado na hora por `confirmar`, então o campo só existe
  // depois; a delegação guarda o que foi digitado enquanto ele está aberto.
  let motivo = '';
  const capturar = (ev: Event): void => {
    const alvo = ev.target as HTMLInputElement | null;
    if (alvo?.id === 'recusa-motivo') motivo = alvo.value;
  };
  document.addEventListener('input', capturar);

  const ok = await confirmar({
    titulo: `Recusar ${projeto.codigo}?`,
    mensagem: html`
      O autor vê o motivo em Projetos e pode corrigir e propor de novo.
      <br /><br />
      <input class="input" id="recusa-motivo" type="text" maxlength="255"
             placeholder="Por que a proposta não foi aceita" aria-label="Motivo da recusa" />`,
    confirmar: 'Recusar',
    perigo: true,
    icone: 'ban',
  });

  document.removeEventListener('input', capturar);
  if (!ok) return;

  if (!motivo.trim()) {
    aviso('Diga o motivo da recusa.', 'error');
    return;
  }

  try {
    await recusarProjeto(projeto.id, motivo.trim());
  } catch (erro) {
    aviso(erroDe(erro, 'Não foi possível recusar o projeto.'), 'error');
    return;
  }

  await carregarProjetos();
  aviso(`Projeto ${projeto.codigo} recusado.`, 'success');
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
  equipeSoLeitura = deFora(projeto);

  setText('equipe-projeto-nome', `Equipe de ${projeto.titulo}`);
  setText(
    'equipe-projeto-desc',
    equipeSoLeitura
      ? 'Você não faz parte deste projeto: dá para ver a equipe, não para mexer.'
      : projeto.descricao ?? projeto.titulo,
  );
  show(el('form-equipe-membro'), !equipeSoLeitura);

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

/**
 * Quem muda o papel na equipe: o líder do projeto e o admin, nunca o próprio
 * (o back-end recusa os demais). A linha do líder não tem seletor: a liderança
 * passa marcando OUTRA pessoa como líder, para o projeto nunca ficar sem.
 */
function podeMudarPapelDe(m: MembroEquipe): boolean {
  if (m.lider) return false;
  if (ehAdmin()) return true;
  return Boolean(projetoAberto?.sou_lider) && String(m.id) !== String(usuarioAtual()?.id);
}

function linhaDeMembro(m: MembroEquipe): string {
  const vazio = html`<span class="table__muted">&mdash;</span>`;
  const quantas = m.permissoes.length;

  if (equipeSoLeitura) {
    return html`
      <tr class="${raw(m.ativo ? '' : 'is-off')}">
        <td data-label="Membro">
          <div class="table__stack">
            <span class="table__name">
              ${m.nome}
              ${raw(m.lider ? html`<span class="pill pill--booked">líder</span>` : '')}
            </span>
            <span class="table__sub">${m.cargo ?? 'sem cargo'}</span>
          </div>
        </td>
        <td data-label="Papel">${m.papel ? PAPEL_ROTULO[m.papel] : '—'}</td>
        <td data-label="Função">${raw(m.funcao ? html`${m.funcao}` : vazio)}</td>
        <td data-label="Permissões">${raw(quantas
          ? html`${String(quantas)} ${quantas === 1 ? 'permissão' : 'permissões'}`
          : html`só leitura`)}</td>
        <td data-label="Ações">${raw(vazio)}</td>
      </tr>`;
  }

  return html`
    <tr class="${raw(m.ativo ? '' : 'is-off')}">
      <td data-label="Membro">
        <div class="table__stack">
          <span class="table__name">
            ${m.nome}
            ${raw(m.lider ? html`<span class="pill pill--booked">líder</span>` : '')}
          </span>
          <span class="table__sub">${m.cargo ?? 'sem cargo'}${m.email ? ` · ${m.email}` : ''}</span>
        </div>
      </td>
      <td data-label="Papel">
        ${raw(podeMudarPapelDe(m)
          ? html`<select class="select select--sm" data-change="papel-membro" data-id="${m.id}"
                         aria-label="Papel de ${m.nome} no projeto">
                   ${raw(juntar(
                     (Object.keys(PAPEL_ROTULO) as PapelEquipe[]).map(
                       (papel) => html`<option value="${papel}" ${raw(m.papel === papel ? 'selected' : '')}>
                                         ${PAPEL_ROTULO[papel]}
                                       </option>`,
                     ),
                   ))}
                 </select>`
          : html`${m.papel ? PAPEL_ROTULO[m.papel] : '—'}`)}
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

  // Passar a liderança tira o papel de quem lidera hoje: confirma antes.
  if (papel === 'LIDER') {
    const atual = equipe.find((m) => m.lider);
    const souEu = atual && String(atual.id) === String(usuarioAtual()?.id);
    const ok = await confirmar({
      titulo: `Passar a liderança para ${membro.nome}?`,
      mensagem: html`<strong>${membro.nome}</strong> passa a liderar o projeto e recebe o
        necessário para conduzi-lo. ${souEu ? 'Você' : atual?.nome ?? 'O líder atual'}
        continua na equipe como pesquisador.`,
      icone: 'shield-user',
      confirmar: 'Passar a liderança',
    });
    if (!ok) {
      renderizarEquipe();
      return;
    }
  }

  try {
    await atualizarMembro(projetoAberto.id, membro.id, { papel: papel as PapelEquipe });
  } catch (erro) {
    aviso(erroDe(erro, 'Não foi possível trocar o papel.'), 'error');
    renderizarEquipe();
    return;
  }

  // O líder do projeto é o responsável: a lista de projetos muda com ele, e
  // quem passou a liderança deixa de poder mexer nos papéis.
  await carregarProjetos();
  projetoAberto = projetos.find((p) => p.id === projetoAberto?.id) ?? projetoAberto;
  await carregarEquipe();

  aviso(
    papel === 'LIDER'
      ? `${membro.nome} agora lidera ${projetoAberto.titulo}.`
      : `${membro.nome} agora é pesquisador em ${projetoAberto.titulo}.`,
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

/* As permissões de cada pessoa ficam no modal "Permissões" da tela de
   Usuários (views/permissoes.ts): sistema e por projeto, num lugar só. */

/* ===========================================================================
   Ficha do projeto (clique no cartão)

   Quem participa, que estufas usa, quanto está reservado e para quê. Os
   números saem das reservas feitas no mapa: reservou lá, aparece aqui na
   próxima vez que a ficha abrir.
   =========================================================================== */

const STATUS_RESERVA: Record<string, { rotulo: string; tom: string }> = {
  ATIVA: { rotulo: 'Aprovada', tom: 'pill--ok' },
  PENDENTE: { rotulo: 'Aguardando aprovação', tom: 'pill--busy' },
  CANCELADA: { rotulo: 'Cancelada', tom: 'pill--neutral' },
};

function quantidadeTexto(q: { vasos: number; bancadas: number }): string {
  const partes = [
    q.vasos ? `${q.vasos} ${q.vasos === 1 ? 'vaso' : 'vasos'}` : '',
    q.bancadas ? `${q.bancadas} ${q.bancadas === 1 ? 'bancada' : 'bancadas'}` : '',
  ].filter(Boolean);
  return partes.length ? partes.join(' e ') : 'nada';
}

export async function abrirFichaDoProjeto(id: string): Promise<void> {
  const corpo = el('projeto-ver-corpo');
  if (!corpo) return;

  const resumo = projetos.find((p) => String(p.id) === id);
  setText('projeto-ver-titulo', resumo?.titulo ?? 'Projeto');
  setText('projeto-ver-sub', 'Lendo a ficha…');
  corpo.innerHTML = '';
  const acoes = el('projeto-ver-acoes');
  if (acoes) acoes.innerHTML = '';
  abrirModal('modal-projeto-ver');

  let ficha: ProjetoDetalhe;
  try {
    ficha = await getProjetoDetalhe(Number(id));
  } catch (erro) {
    setText('projeto-ver-sub', '');
    corpo.innerHTML = html`<p class="empty__text">${erroDe(erro, 'Não foi possível ler a ficha do projeto.')}</p>`;
    return;
  }

  const periodo = ficha.data_inicio || ficha.data_fim
    ? `${ficha.data_inicio ? dataBR(ficha.data_inicio) : '—'} a ${ficha.data_fim ? dataBR(ficha.data_fim) : 'sem fim'}`
    : 'Sem período definido';
  setText('projeto-ver-titulo', ficha.titulo);
  setText(
    'projeto-ver-sub',
    [ficha.codigo, ficha.status?.descricao, `Líder: ${ficha.responsavel?.nome ?? '—'}`, periodo].filter(Boolean).join(' · '),
  );

  const m = ficha.metricas;
  corpo.innerHTML = html`
    ${raw(!ficha.participo
      ? html`<p class="field__aviso">${icone('eye', 'ic ic--sm')}Você não faz parte deste projeto: dá para ver, não para mexer.</p>`
      : '')}
    <div class="stats" id="projeto-ver-stats"></div>

    <section class="ficha__secao" aria-labelledby="ficha-sobre">
      <h3 class="ficha__titulo" id="ficha-sobre">O que o projeto faz</h3>
      <p class="ficha__texto">${ficha.descricao || 'Sem descrição.'}</p>
    </section>

    <section class="ficha__secao" aria-labelledby="ficha-equipe">
      <h3 class="ficha__titulo" id="ficha-equipe">Equipe (${String(ficha.equipe.length)})</h3>
      <ul class="ficha__equipe">
        ${raw(juntar(ficha.equipe.map((pessoa) => html`
          <li class="ficha__pessoa">
            ${avatar(pessoa.nome)}
            <span class="table__stack">
              <span class="table__name">${pessoa.nome}
                ${raw(pessoa.lider ? html`<span class="pill pill--booked">líder</span>` : '')}</span>
              <span class="table__sub">${pessoa.cargo ?? 'sem cargo'}${pessoa.email ? ` · ${pessoa.email}` : ''}</span>
            </span>
          </li>`)))}
      </ul>
    </section>

    <section class="ficha__secao" aria-labelledby="ficha-estufas">
      <h3 class="ficha__titulo" id="ficha-estufas">Onde está plantado</h3>
      ${raw(ficha.reservas.length
        ? html`<div class="table-wrap"><table class="table">
            <thead><tr>
              <th scope="col">Estufa</th><th scope="col">Quantidade</th><th scope="col">Período</th>
              <th scope="col">Finalidade</th><th scope="col">Situação</th><th scope="col">Reservou</th>
            </tr></thead>
            <tbody>${raw(juntar(ficha.reservas.map((r) => {
              const st = STATUS_RESERVA[r.status] ?? { rotulo: r.status, tom: 'pill--neutral' };
              return html`<tr class="${raw(r.encerrada ? 'is-off' : '')}">
                <td data-label="Estufa"><span class="code">${r.estufa?.codigo ?? '—'}</span></td>
                <td data-label="Quantidade">${String(r.quantidade)} ${r.quantidade === 1 ? r.unidade.replace(/s$/, '') : r.unidade}</td>
                <td data-label="Período">${dataBR(r.data_inicio)} a ${dataBR(r.data_fim)}</td>
                <td data-label="Finalidade">${r.finalidade ?? '—'}</td>
                <td data-label="Situação"><span class="pill ${raw(st.tom)}">${r.encerrada ? 'Terminada' : st.rotulo}</span></td>
                <td data-label="Reservou">${r.quem ?? '—'}</td>
              </tr>`;
            })))}</tbody>
          </table></div>`
        : html`<p class="empty__text">Nenhuma estufa reservada ainda. As reservas são feitas pelo mapa.</p>`)}
    </section>`;

  pintarStats('projeto-ver-stats', [
    { icone: 'users', numero: m.pessoas, rotulo: m.pessoas === 1 ? 'Pessoa na equipe' : 'Pessoas na equipe' },
    { icone: 'leaf', numero: m.estufas_em_uso, rotulo: m.estufas_em_uso === 1 ? 'Estufa reservada' : 'Estufas reservadas', tom: 'booked' },
    { icone: 'calendar-check', numero: m.em_uso_hoje.vasos + m.em_uso_hoje.bancadas, rotulo: `Em uso hoje: ${quantidadeTexto(m.em_uso_hoje)}`, tom: 'ok' },
    { icone: 'clock', numero: m.pendentes, rotulo: m.pendentes === 1 ? 'Reserva aguardando' : 'Reservas aguardando', tom: m.pendentes ? 'busy' : undefined },
  ]);

  if (acoes) {
    acoes.innerHTML = juntar([
      html`<button type="button" class="btn btn--quiet" data-action="fechar">Fechar</button>`,
      ficha.participo
        ? html`<button type="button" class="btn btn--quiet" data-action="abrir-equipe" data-id="${ficha.id}">
                 ${icone('users', 'ic ic--sm')}Equipe</button>`
        : '',
      ficha.posso_convidar
        ? html`<button type="button" class="btn btn--primary" data-action="abrir-convidar" data-id="${ficha.id}" data-titulo="${ficha.titulo}">
                 ${icone('user-plus', 'ic ic--sm')}Convidar</button>`
        : '',
    ]);
  }
}
