/**
 * Administração: métricas, espaços, reservas e usuários.
 *
 * Espaços ficam na tela de administração; reservas e usuários têm seção
 * própria no menu. Este arquivo desenha as três tabelas, porque as contas e o
 * cadastro são os mesmos.
 *
 * O acesso é verificado a cada render, não só na navegação.
 *
 * Tudo que esta tela altera é gravado no banco: aprovar e cancelar reserva,
 * mudar a situação do espaço e cadastrar, desativar ou excluir usuário.
 *
 * Duas noções de "status" convivem na tabela de espaços, e confundi-las foi
 * fonte de bug: a SITUAÇÃO é o que se grava (ATIVA, RESERVADA, OCUPADA,
 * MANUTENCAO, INATIVA); o STATUS mostrado é calculado da ocupação (livre,
 * parcial, ocupada) quando a situação é ATIVA.
 *
 * RESERVADA e OCUPADA são bloqueios manuais: a administração segura o espaço
 * — visita, experimento próprio, estufa cheia por fora do sistema — sem ter de
 * inventar uma reserva. Nenhuma das duas é calculada: continuam valendo as
 * contas de ocupação para quem está ATIVA.
 */
import {
  ESTUFAS,
  ID_REAL_ESPACO,
  ID_REAL_RESERVA,
  carregarEstado,
  invalidarEstado,
  reservas,
  proximasReservas,
  reservasDoEspaco,
  reservasVigentes,
} from '../data/estufas';
import { dadosMudaram } from '../lib/bus';
import { el, qsa, setText, show } from '../lib/dom';
import { html, icone, juntar, raw } from '../lib/html';
import { capacidade, dataBR, dataHoraBR, ocupacaoResumo, statusPill } from '../lib/format';
import { abrirModal, confirmar, fecharModal, fecharTodosModais } from '../lib/modal';
import { irParaSecao } from '../lib/navegacao';
import { avatar, pintarStats } from '../lib/telas';
import { aviso } from '../lib/toast';
import {
  atualizarEspaco,
  atualizarSituacaoEspaco,
  aprovarReserva as apiAprovar,
  criarEspaco,
  getCargos,
  getPainel,
  getSituacaoDoEmail,
  getTiposEspaco,
  type CargoApi,
  type EnvioDoConvite,
  type DadosEspaco,
} from '../services/api';
import { cancelarNoDestino } from './reservas';
import {
  alternarAcessoUsuario,
  cadastrarUsuario,
  editarUsuario,
  excluirUsuario,
  listarUsuarios,
  recarregarUsuarios,
  reenviarConviteUsuario,
  usuarioAtual,
} from './login';
import type {
  EstufaSituacao,
  PerfilUsuario,
  Reserva,
  UnidadeCapacidade,
  Usuario,
} from '../types';

type FiltroReserva = 'todas' | 'pendente' | 'ativa';

/** Recortes da lista de usuários: perfil, acesso sem senha e desativados. */
export type FiltroUsuario = 'todos' | 'admin' | 'pesquisador' | 'sem-senha' | 'inativo';

/**
 * O que o administrador pode gravar, na ordem em que a tela mostra. Mesma
 * lista de `CasaVegetacao::STATUS` no back-end — quem recusa um valor fora
 * dela é a validação da API, não esta tela.
 */
const SITUACOES: { valor: EstufaSituacao; label: string }[] = [
  { valor: 'ATIVA', label: 'Disponível para reserva' },
  { valor: 'RESERVADA', label: 'Reservada' },
  { valor: 'OCUPADA', label: 'Ocupada' },
  { valor: 'MANUTENCAO', label: 'Em manutenção' },
  { valor: 'INATIVA', label: 'Inativa' },
];

/** Quantas sugestões de estufa o seletor do formulário mostra de uma vez. */
const MAX_SUGESTOES = 8;

let buscaEspacos = '';
let buscaReservas = '';
let buscaUsuarios = '';
let filtroReservas: FiltroReserva = 'todas';
let filtroUsuarios: FiltroUsuario = 'todos';
let perfilNovoUsuario: PerfilUsuario = 'pesquisador';
/** Perfil escolhido no formulário de edição de usuário. */
let perfilEdicao: PerfilUsuario = 'pesquisador';
/** Usuário aberto no formulário de edição. */
let usuarioEmEdicao: string | null = null;
/** Cargos do cadastro, lidos uma vez e reusados pelos dois formulários. */
let cargos: CargoApi[] = [];
/** Chave do espaço aberto no formulário; null = cadastro novo. */
let espacoEmEdicao: string | null = null;

function ehAdmin(): boolean {
  return usuarioAtual()?.admin === true;
}

export function renderizarAdmin(): void {
  if (!ehAdmin()) return;
  renderizarMetricas();
  renderizarEspacos();
  renderizarReservas();
  renderizarUsuarios();

  // Números do painel e lista de usuários vêm do back-end.
  void atualizarDoServidor();
}

/** Relê do banco o que a tela de administração mostra. */
async function atualizarDoServidor(): Promise<void> {
  await Promise.allSettled([atualizarMetricasDaApi(), atualizarUsuariosDaApi()]);
}

/* ===========================================================================
   Métricas
   =========================================================================== */

/**
 * Calcula as métricas com o que está na memória: é o que aparece no primeiro
 * instante, antes da resposta do /painel.
 */
function renderizarMetricas(): void {
  const espacos = Object.values(ESTUFAS);
  const total = espacos.length;
  const livres = espacos.filter((e) => e.status === 'livre').length;
  const ocupados = espacos.filter((e) => e.status === 'ocupada' || e.status === 'parcial').length;
  const manutencao = espacos.filter((e) => e.status === 'manutencao').length;
  const emAberto = reservas.filter((r) => r.status === 'ativa' || r.status === 'pendente').length;
  const pendentes = reservas.filter((r) => r.status === 'pendente').length;

  // Taxa pela capacidade, não pelo número de estufas: é o que de fato está
  // tomado dentro delas. Uma estufa com 1 de 20 vasos não está "ocupada".
  const capacidadeTotal = espacos.reduce((soma, e) => soma + e.capacidadeTotal, 0);
  const capacidadeOcupada = espacos.reduce((soma, e) => soma + Math.min(e.ocupado, e.capacidadeTotal), 0);
  const taxa = capacidadeTotal ? Math.round((capacidadeOcupada / capacidadeTotal) * 100) : 0;

  pintarMetricas({ total, livres, ocupados, manutencao, emAberto, pendentes, taxa });
}

/** As mesmas métricas, calculadas no back-end sobre o banco inteiro. */
async function atualizarMetricasDaApi(): Promise<void> {
  try {
    const painel = await getPainel();
    const m = painel?.metricas;
    if (!m) return;

    pintarMetricas({
      total: m.total_espacos ?? 0,
      livres: m.livres ?? 0,
      ocupados: m.ocupados ?? 0,
      manutencao: m.manutencao ?? 0,
      emAberto: m.reservas_em_aberto ?? 0,
      pendentes: m.pendentes ?? 0,
      taxa: m.taxa_ocupacao ?? 0,
    });
  } catch (erro) {
    console.warn('[CVGWeb] não foi possível ler o painel da API:', erro);
  }
}

interface Metricas {
  total: number;
  livres: number;
  ocupados: number;
  manutencao: number;
  emAberto: number;
  pendentes: number;
  taxa: number;
}

function pintarMetricas(m: Metricas): void {
  setText('m-total', String(m.total));
  setText('m-livres', String(m.livres));
  setText('m-reservas', String(m.emAberto));
  setText('m-pendentes', String(m.pendentes));
  setText('m-manutencao', String(m.manutencao));
  setText('m-taxa', `${m.taxa}%`);

  const barra = el('m-taxa-barra');
  if (barra) barra.style.width = `${m.taxa}%`;
  el('m-taxa-barra-wrap')?.setAttribute('aria-valuenow', String(m.taxa));
}

/* ===========================================================================
   Espaços
   =========================================================================== */

/**
 * Quem está com o espaço, para a coluna "Reservado por".
 *
 * Com a reserva parcial, várias pessoas dividem a mesma estufa no mesmo
 * período — a versão antiga mostrava só a primeira. Agora lista as maiores e
 * resume o resto.
 */
function celulaReservadoPor(id: string): string {
  const estufa = ESTUFAS[id];
  const atuais = reservasDoEspaco(id);

  if (!atuais.length) return html`<span class="table__muted">&mdash;</span>`;

  const mostradas = atuais.slice(0, 2);
  const restantes = atuais.length - mostradas.length;

  return html`
    <div class="table__stack">
      ${raw(juntar(mostradas.map((reserva) => html`
        <span class="table__name">
          ${reserva.pesquisador?.trim() || 'Responsável não informado'}
          <span class="table__sub">
            &middot; ${capacidade(reserva.quantidade, estufa.unidade)}
            ${raw(reserva.status === 'pendente'
              ? html` <span class="pill pill--busy">${icone('clock', 'ic ic--sm')}pendente</span>`
              : '')}
          </span>
        </span>
        <span class="table__sub">${dataBR(reserva.data)} a ${dataBR(reserva.dataFim)}</span>`)))}
      ${raw(restantes > 0
        ? html`<span class="table__sub">e mais ${restantes} ${restantes === 1 ? 'reserva' : 'reservas'}</span>`
        : '')}
    </div>`;
}

/** Cor do anel ao lado do nome: as mesmas quatro da legenda do mapa. */
function grupoDoAnel(status: string): string {
  if (status === 'ocupada') return 'ocupada';
  if (status === 'reservada') return 'reservada';
  if (status === 'manutencao' || status === 'inativa') return 'manutencao';
  return 'livre';
}

function renderizarEspacos(): void {
  const corpo = el('tbody-espacos');
  if (!corpo) return;

  const termo = buscaEspacos.trim().toLowerCase();
  const todos = Object.entries(ESTUFAS);

  const situacoes = todos.map(([, e]) => e.status);
  pintarStats('stats-espacos', [
    { icone: 'warehouse', numero: todos.length, rotulo: 'Espaços' },
    { icone: 'circle-check', numero: situacoes.filter((x) => x === 'livre' || x === 'parcial').length, rotulo: 'Com vaga hoje', tom: 'ok' },
    { icone: 'user', numero: situacoes.filter((x) => x === 'ocupada' || x === 'reservada').length, rotulo: 'Ocupados ou reservados', tom: 'busy' },
    { icone: 'wrench', numero: situacoes.filter((x) => x === 'manutencao' || x === 'inativa').length, rotulo: 'Manutenção ou inativos', tom: 'down' },
  ]);
  const linhas = todos.filter(([id, e]) => {
    if (!termo) return true;
    const responsaveis = reservasDoEspaco(id).map((r) => r.pesquisador ?? '').join(' ');
    return (
      e.codigo.toLowerCase().includes(termo)
      || id.toLowerCase().includes(termo)
      || e.nome.toLowerCase().includes(termo)
      || e.tipo.toLowerCase().includes(termo)
      || responsaveis.toLowerCase().includes(termo)
    );
  });

  atualizarContador('conta-espacos', linhas.length, todos.length, Boolean(termo));

  if (!linhas.length) {
    corpo.innerHTML = linhaVazia(
      9,
      'warehouse',
      termo ? `Nenhum espaço corresponde a “${buscaEspacos}”.` : 'Nenhum espaço cadastrado.',
    );
    return;
  }

  corpo.innerHTML = juntar(
    linhas.map(([id, e]) => html`
      <tr>
        <td data-label="Código"><span class="code">${e.codigo}</span></td>
        <td data-label="Nome" class="table__name">
          <span class="who" data-status="${grupoDoAnel(e.status)}"><span class="ring" aria-hidden="true"></span>${e.nome}</span>
        </td>
        <td data-label="Tipo" class="table__muted">
          <span class="table__type">${icone(e.icon, 'ic ic--sm')}${e.tipo}</span>
        </td>
        <td data-label="Área">${e.area}</td>
        <td data-label="Capacidade">
          <div class="table__stack">
            <span class="table__name">${ocupacaoResumo(e.disponivel, e.capacidadeTotal, e.unidade)}</span>
            ${raw(e.cap > 0
              ? html`<span class="table__sub">${e.cap} ${e.cap === 1 ? 'bancada' : 'bancadas'}</span>`
              : '')}
          </div>
        </td>
        <td data-label="Status">${statusPill(e.status)}</td>
        <td data-label="Reservado por">${raw(celulaReservadoPor(id))}</td>
        <td data-label="Situação">
          <div class="table__actions">
            <select class="select status-select" data-status="${e.situacao.toLowerCase()}"
                    data-change="situacao-espaco" data-id="${id}"
                    aria-label="Alterar a situação de ${e.nome}">
              ${raw(opcoesSituacao(e.situacao))}
            </select>
          </div>
        </td>
        <td data-label="Editar">
          <div class="table__actions">
            <button type="button" class="btn btn--quiet btn--sm btn--icon"
                    data-action="editar-espaco" data-id="${id}"
                    aria-label="Editar o cadastro de ${e.nome}">
              ${icone('ruler', 'ic ic--sm')}
            </button>
          </div>
        </td>
      </tr>
    `),
  );
}

function opcoesSituacao(atual: EstufaSituacao): string {
  return juntar(
    SITUACOES.map(
      ({ valor, label }) => html`
        <option value="${valor}" ${raw(valor === atual ? 'selected' : '')}>${label}</option>`,
    ),
  );
}

/**
 * Grava a nova situação do espaço. Livre, parcial e ocupada não entram aqui:
 * são consequência das reservas, não escolha do administrador.
 */
/* ===========================================================================
   Cargos

   A lista vem de /api/cargos (CargoSeeder). Antes o formulário de usuário não
   tinha o campo, então toda pessoa era cadastrada sem cargo e a coluna Cargo
   da tabela vivia em "—".
   =========================================================================== */

async function garantirCargos(): Promise<CargoApi[]> {
  if (cargos.length) return cargos;

  cargos = await getCargos().catch(() => []);
  return cargos;
}

/** Enche um select de cargo, marcando o que a pessoa já tem. */
function pintarCargos(id: string, escolhido?: number | null): void {
  const select = el<HTMLSelectElement>(id);
  if (!select) return;

  select.innerHTML = juntar([
    html`<option value="">Sem cargo definido</option>`,
    ...cargos.map((c) => html`<option value="${c.id}">${c.nome}</option>`),
  ]);

  if (escolhido) select.value = String(escolhido);
}

/** Lê os cargos em segundo plano e repinta o select quando chegarem. */
function prepararCargos(id: string, escolhido?: number | null): void {
  pintarCargos(id, escolhido);
  if (cargos.length) return;

  void garantirCargos().then(() => pintarCargos(id, escolhido));
}

export async function alterarSituacaoEspaco(id: string, situacao: string): Promise<void> {
  const estufa = ESTUFAS[id];
  if (!estufa) return;

  const nova = SITUACOES.find((s) => s.valor === situacao)?.valor;
  if (!nova) return;

  const anterior = estufa.situacao;
  if (nova === anterior) return;

  try {
    const casaId = ID_REAL_ESPACO[id];
    if (!casaId) throw new Error('Espaço sem vínculo com o cadastro; recarregue a página.');

    await atualizarSituacaoEspaco(casaId, nova);
    invalidarEstado();
    await carregarEstado('manter');
  } catch (erro) {
    estufa.situacao = anterior;
    dadosMudaram();
    aviso(erro instanceof Error ? erro.message : 'Não foi possível alterar a situação.', 'error');
    return;
  }

  dadosMudaram();
  aviso(
    `${estufa.nome}: ${SITUACOES.find((s) => s.valor === nova)!.label.toLowerCase()}.`,
    'success',
  );
}

export function buscarEspacos(termo: string): void {
  buscaEspacos = termo;
  show(el('limpar-espacos'), Boolean(termo));
  renderizarEspacos();
}

/* ===========================================================================
   Cadastro do espaço
   =========================================================================== */

function campo<T extends HTMLElement = HTMLInputElement>(id: string): T | null {
  return el<T>(id);
}

function definirValor(id: string, valor: string | number | null | undefined): void {
  const node = el<HTMLInputElement>(id);
  if (node) node.value = valor === null || valor === undefined ? '' : String(valor);
}

function valorDoCampo(id: string): string {
  return (el<HTMLInputElement>(id)?.value ?? '').trim();
}

function numeroDoCampo(id: string): number | null {
  const bruto = valorDoCampo(id);
  if (bruto === '') return null;
  const n = Number.parseInt(bruto, 10);
  return Number.isNaN(n) ? null : n;
}

function mostrarErroEspaco(mensagem: string | null): void {
  show(el('espaco-erro'), Boolean(mensagem));
  if (mensagem) setText('espaco-erro-texto', mensagem);
}

/* --- Qual estufa: combobox em vez de campos em branco -------------------- */

/**
 * O parque é fechado: são as 50 estufas do Cenargen. Por isso este formulário
 * começa perguntando QUAL estufa, e não com campos vazios — cadastrar a 51ª é
 * a exceção, e o back-end é que decide se ela cabe (config espacos.limite).
 *
 * Também não é um <select>: 50 opções numa lista rolante é pior do que digitar
 * "CVG0" e escolher. `sugestoesVisiveis` guarda as chaves na ordem mostrada,
 * para as setas do teclado andarem na mesma ordem que os olhos.
 */
let sugestoesVisiveis: string[] = [];
let sugestaoAtiva = -1;

/** Abre o formulário. Com `id`, já carrega o cadastro daquela estufa. */
export function abrirEspaco(id?: string): void {
  espacoEmEdicao = null;
  sugestoesVisiveis = [];
  sugestaoAtiva = -1;

  el<HTMLFormElement>('form-espaco')?.reset();
  definirValor('espaco-capacidade-total', 0);
  mostrarErroEspaco(null);
  fecharSugestoes();
  preencherListasDeTexto();

  if (id && ESTUFAS[id]) {
    carregarEspacoNoFormulario(id);
    abrirModal('modal-espaco');
    return;
  }

  setText('espaco-titulo', 'Alterar estufa');
  setText('espaco-descricao', 'Escolha a estufa pelo código e corrija o que mudou no cadastro.');
  setText('espaco-enviar-texto', 'Salvar');
  pintarResumoDoEspaco(null);
  marcarAlvo(null);

  abrirModal('modal-espaco');
  campo<HTMLInputElement>('espaco-codigo')?.focus();
}

/** Atalho do lápis na tabela: abre o formulário já naquela estufa. */
export function abrirEditarEspaco(id: string): void {
  abrirEspaco(id);
}

/** Põe o cadastro atual da estufa nos campos e passa o formulário a modo edição. */
function carregarEspacoNoFormulario(id: string): void {
  const estufa = ESTUFAS[id];
  if (!estufa) return;

  espacoEmEdicao = id;

  setText('espaco-titulo', `Alterar ${estufa.codigo}`);
  setText('espaco-descricao', `${estufa.nome} · ${estufa.tipo}`);
  setText('espaco-enviar-texto', 'Salvar');
  pintarResumoDoEspaco(id);

  definirValor('espaco-codigo', estufa.codigo);
  definirValor('espaco-descricao-campo', estufa.nome);
  definirValor('espaco-tipo', estufa.tipo);
  definirValor('espaco-localizacao', estufa.setor === '—' ? '' : estufa.setor);
  definirValor('espaco-capacidade-total', estufa.capacidadeTotal);
  definirValor('espaco-area', estufa.area.replace(/\D/g, ''));
  definirValor('espaco-bancadas', estufa.cap || '');
  definirValor('espaco-obs', estufa.desc);

  const unidade = el<HTMLSelectElement>('espaco-unidade');
  if (unidade) unidade.value = estufa.unidade;

  const situacao = el<HTMLSelectElement>('espaco-situacao');
  if (situacao) situacao.value = estufa.situacao;

  mostrarErroEspaco(null);
  marcarAlvo(id);
  fecharSugestoes();

  // Quem está digitando o código continua digitando: o cursor não sai do campo.
  const codigo = campo<HTMLInputElement>('espaco-codigo');
  if (codigo && document.activeElement === codigo) {
    codigo.setSelectionRange(codigo.value.length, codigo.value.length);
  }
}

/**
 * Passa o formulário a modo edição sem reescrever campo nenhum.
 *
 * Diferente de `carregarEspacoNoFormulario`, que traz o cadastro do banco para
 * a tela: aqui a pessoa já digitou os valores que quer: só faltava descobrir
 * que CVG12 é a estufa E12. Recarregar os campos aqui apagaria o que ela
 * acabou de escrever — foi exatamente o que acontecia.
 */
function apontarPara(id: string): void {
  const estufa = ESTUFAS[id];
  if (!estufa) return;

  espacoEmEdicao = id;
  setText('espaco-titulo', `Alterar ${estufa.codigo}`);
  setText('espaco-enviar-texto', 'Salvar');
  pintarResumoDoEspaco(id);
  marcarAlvo(id);
}

/**
 * Faixa com a situação de hoje da estufa escolhida: capacidade, quanto está em
 * uso, quanto sobra e quantas reservas vigentes existem.
 *
 * É a informação que faltava no formulário — sem ela, reduzir a capacidade era
 * um palpite que só o erro do back-end corrigia.
 */
function pintarResumoDoEspaco(id: string | null): void {
  const caixa = el('espaco-resumo');
  if (!caixa) return;

  const estufa = id ? ESTUFAS[id] : null;
  show(caixa, Boolean(estufa));
  if (!estufa || !id) return;

  setText('espaco-resumo-capacidade', capacidade(estufa.capacidadeTotal, estufa.unidade));
  setText('espaco-resumo-ocupado', capacidade(estufa.ocupado, estufa.unidade));
  setText('espaco-resumo-livre', capacidade(estufa.disponivel, estufa.unidade));

  const vigentes = proximasReservas(id).length;
  setText(
    'espaco-resumo-reservas',
    vigentes ? `${vigentes} ${vigentes === 1 ? 'reserva' : 'reservas'}` : 'nenhuma',
  );
}

/**
 * Diz, abaixo do campo de busca, o que o formulário vai gravar. Sem isto, a
 * pessoa digita um código parecido e não percebe que está criando um espaço
 * novo em vez de alterar o que queria.
 */
function marcarAlvo(id: string | null): void {
  const alvo = el('espaco-alvo');
  if (!alvo) return;

  if (id && ESTUFAS[id]) {
    const estufa = ESTUFAS[id];
    alvo.dataset.tom = 'edicao';
    alvo.innerHTML = html`
      ${icone('ruler', 'ic ic--sm')}
      Alterando o cadastro de ${estufa.codigo} — ${estufa.nome}.`;
    return;
  }

  const digitado = valorDoCampo('espaco-codigo');
  if (!digitado) {
    alvo.dataset.tom = 'edicao';
    alvo.textContent = '';
    return;
  }

  alvo.dataset.tom = 'novo';
  alvo.innerHTML = html`
    ${icone('info', 'ic ic--sm')}
    Nenhuma estufa cadastrada casa com “${digitado}”. Salvar assim tenta
    cadastrar um espaço novo.`;
}

/** Estufas que casam com o termo, na ordem do código. */
function sugerirEstufas(termo: string): string[] {
  const busca = termo.trim().toLowerCase();

  return Object.entries(ESTUFAS)
    .filter(([chave, e]) => !busca
      || e.codigo.toLowerCase().includes(busca)
      || e.nome.toLowerCase().includes(busca)
      || e.tipo.toLowerCase().includes(busca)
      || (e.setor ?? '').toLowerCase().includes(busca)
      || chave.toLowerCase().includes(busca))
    .sort(([, a], [, b]) => a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true }))
    .slice(0, MAX_SUGESTOES)
    .map(([chave]) => chave);
}

/** Redesenha a lista de sugestões a partir do que está digitado. */
export function buscarEstufaNoFormulario(termo: string): void {
  const lista = el('espaco-sugestoes');
  const entrada = el<HTMLInputElement>('espaco-codigo');
  if (!lista || !entrada) return;

  sugestoesVisiveis = sugerirEstufas(termo);
  sugestaoAtiva = -1;

  // Trocar o código desfaz a escolha anterior: o formulário não pode continuar
  // apontando para CVG01 enquanto o campo já diz CVG20.
  if (espacoEmEdicao && ESTUFAS[espacoEmEdicao]) {
    if (ESTUFAS[espacoEmEdicao].codigo.toLowerCase() !== termo.trim().toLowerCase()) {
      espacoEmEdicao = null;
      setText('espaco-titulo', 'Alterar estufa');
      setText('espaco-enviar-texto', 'Salvar');
      pintarResumoDoEspaco(null);
    }
  }

  if (!termo.trim()) {
    fecharSugestoes();
    marcarAlvo(espacoEmEdicao);
    return;
  }

  lista.innerHTML = sugestoesVisiveis.length
    ? juntar(sugestoesVisiveis.map((chave) => {
      const e = ESTUFAS[chave];
      return html`
        <li class="combo__opcao" role="option" id="sugestao-${chave}" aria-selected="false"
            data-action="escolher-estufa" data-id="${chave}">
          <strong>${e.codigo}</strong>
          <span class="combo__sub">
            ${e.nome} · ${e.tipo}${raw(e.setor && e.setor !== '—' ? html` · ${e.setor}` : '')}
            · ${capacidade(e.capacidadeTotal, e.unidade)}
          </span>
        </li>`;
    }))
    : html`<li class="combo__vazio" role="presentation">Nenhuma estufa com esse código ou nome.</li>`;

  show(lista, true);
  entrada.setAttribute('aria-expanded', 'true');
  entrada.removeAttribute('aria-activedescendant');

  // Enquanto ainda há estufa na lista, a pessoa está no meio de digitar: avisar
  // que "vai cadastrar um espaço novo" aí só atrapalha. O aviso é para quando
  // o código digitado não casa com nada.
  // Código completo de uma estufa que existe traz o cadastro dela na hora, sem
  // precisar clicar na sugestão. Sem isto, quem digitava "CVG05" e salvava
  // apontava para a CVG05 com o resto do formulário EM BRANCO — e gravava
  // capacidade 0, área e bancadas vazias por cima do cadastro real.
  const exata = casaExata(termo);
  if (exata && exata !== espacoEmEdicao) {
    carregarEspacoNoFormulario(exata);
    return;
  }

  const alvo = espacoEmEdicao ?? exata;
  if (alvo || !sugestoesVisiveis.length) marcarAlvo(alvo);
  else limparAlvo();
}

/** Apaga a linha de alvo sem dizer nada — estado neutro, no meio da digitação. */
function limparAlvo(): void {
  const alvo = el('espaco-alvo');
  if (!alvo) return;
  alvo.dataset.tom = 'edicao';
  alvo.textContent = '';
}

/** Código digitado que bate exatamente com uma estufa, se houver. */
function casaExata(termo: string): string | null {
  const busca = termo.trim().toLowerCase();
  if (!busca) return null;

  const achado = Object.entries(ESTUFAS).find(([, e]) => e.codigo.toLowerCase() === busca);

  return achado ? achado[0] : null;
}

function fecharSugestoes(): void {
  const lista = el('espaco-sugestoes');
  const entrada = el<HTMLInputElement>('espaco-codigo');

  show(lista, false);
  if (lista) lista.innerHTML = '';
  entrada?.setAttribute('aria-expanded', 'false');
  entrada?.removeAttribute('aria-activedescendant');
  sugestaoAtiva = -1;
}

/** Setas, Enter e Esc na lista de sugestões. */
export function navegarSugestoesDeEspaco(tecla: string): boolean {
  const lista = el('espaco-sugestoes');
  if (!lista || lista.hidden || !sugestoesVisiveis.length) {
    if (tecla === 'ArrowDown') {
      buscarEstufaNoFormulario(valorDoCampo('espaco-codigo') || 'CVG');
      return true;
    }
    return false;
  }

  if (tecla === 'Escape') {
    fecharSugestoes();
    return true;
  }

  if (tecla === 'Enter') {
    const chave = sugestoesVisiveis[sugestaoAtiva] ?? sugestoesVisiveis[0];
    if (chave) escolherEstufa(chave);
    return true;
  }

  const passo = tecla === 'ArrowDown' ? 1 : tecla === 'ArrowUp' ? -1 : 0;
  if (!passo) return false;

  sugestaoAtiva = (sugestaoAtiva + passo + sugestoesVisiveis.length) % sugestoesVisiveis.length;

  for (const [indice, chave] of sugestoesVisiveis.entries()) {
    const opcao = el(`sugestao-${chave}`);
    opcao?.setAttribute('aria-selected', String(indice === sugestaoAtiva));
    if (indice === sugestaoAtiva) {
      opcao?.scrollIntoView({ block: 'nearest' });
      el<HTMLInputElement>('espaco-codigo')?.setAttribute('aria-activedescendant', `sugestao-${chave}`);
    }
  }

  return true;
}

/** Escolha feita no clique ou no Enter: carrega aquela estufa no formulário. */
export function escolherEstufa(id: string): void {
  carregarEspacoNoFormulario(id);
  campo<HTMLInputElement>('espaco-descricao-campo')?.focus();
}

/**
 * Sugestões dos campos de texto livre (tipo e setor).
 *
 * São sugestões, não opções: os dois campos continuam aceitando qualquer
 * texto. O que já existe no cadastro vem de `ESTUFAS`; com API configurada, o
 * back-end completa a lista em `/casas-vegetacao/tipos` — é lá que fica a
 * lista de tipos previstos, não aqui.
 */
function preencherListasDeTexto(): void {
  const espacos = Object.values(ESTUFAS);

  pintarLista('lista-tipos-espaco', espacos.map((e) => e.tipo));
  pintarLista('lista-setores-espaco', espacos.map((e) => e.setor ?? ''));

  void completarListasDaApi();
}

async function completarListasDaApi(): Promise<void> {
  try {
    const resposta = await getTiposEspaco();
    pintarLista('lista-tipos-espaco', [
      ...Object.values(ESTUFAS).map((e) => e.tipo),
      ...(resposta?.tipos ?? []),
    ]);
    pintarLista('lista-setores-espaco', [
      ...Object.values(ESTUFAS).map((e) => e.setor ?? ''),
      ...(resposta?.setores ?? []),
    ]);
  } catch (erro) {
    // Sugestão é conveniência: sem ela o campo continua funcionando.
    console.warn('[CVGWeb] não foi possível ler os tipos de espaço:', erro);
  }
}

function pintarLista(id: string, valores: string[]): void {
  const lista = el(id);
  if (!lista) return;

  const unicos = [...new Set(valores.map((v) => v.trim()).filter((v) => v && v !== '—'))]
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));

  lista.innerHTML = juntar(unicos.map((valor) => html`<option value="${valor}"></option>`));
}

/** Grava o cadastro: POST quando é novo, PUT quando está editando. */
export async function confirmarEspaco(): Promise<void> {
  // Quem digitou o codigo na busca e foi direto ao botao nunca clicou numa
  // sugestao: sem isto, alterar CVG01 viraria uma tentativa de cadastrar
  // CVG01 de novo, e o erro que apareceria seria "codigo repetido".
  if (!espacoEmEdicao) {
    const digitada = casaExata(valorDoCampo('espaco-codigo'));
    if (digitada) apontarPara(digitada);
  }

  fecharSugestoes();

  const codigo = valorDoCampo('espaco-codigo').toUpperCase();
  const descricao = valorDoCampo('espaco-descricao-campo');
  const capacidadeTotal = numeroDoCampo('espaco-capacidade-total');

  if (!codigo || !descricao) {
    mostrarErroEspaco('Informe o código e o nome do espaço.');
    return;
  }

  if (capacidadeTotal === null || capacidadeTotal < 0) {
    mostrarErroEspaco('Informe a capacidade reservável (pode ser 0 enquanto não for medida).');
    return;
  }

  const dados: DadosEspaco = {
    codigo,
    descricao,
    // Texto livre: vai como a pessoa escreveu. Em branco, o back-end aplica
    // o padrao da coluna em vez de inventarmos um tipo aqui.
    tipo: valorDoCampo('espaco-tipo') || undefined,
    localizacao: valorDoCampo('espaco-localizacao') || undefined,
    area_m2: numeroDoCampo('espaco-area'),
    // Bancadas em branco é "não mexe", não "zero": a coluna é NOT NULL.
    capacidade: numeroDoCampo('espaco-bancadas') ?? undefined,
    unidade_capacidade: (valorDoCampo('espaco-unidade') || 'VASO') as UnidadeCapacidade,
    capacidade_total: capacidadeTotal,
    obs: valorDoCampo('espaco-obs') || null,
    status: (valorDoCampo('espaco-situacao') || 'ATIVA') as EstufaSituacao,
  };

  const botao = el<HTMLButtonElement>('espaco-enviar');
  if (botao) botao.disabled = true;

  try {
    await gravarEspacoNaApi(dados);
  } catch (erro) {
    // A mensagem do back-end é a boa: código repetido, capacidade abaixo do
    // que já está reservado, etc.
    mostrarErroEspaco(erro instanceof Error ? erro.message : 'Não foi possível salvar o espaço.');
    return;
  } finally {
    if (botao) botao.disabled = false;
  }

  const novo = espacoEmEdicao === null;
  espacoEmEdicao = null;
  mostrarErroEspaco(null);
  fecharTodosModais();
  dadosMudaram();

  aviso(
    novo
      ? `Espaço ${dados.codigo} cadastrado com ${capacidade(dados.capacidade_total, dados.unidade_capacidade)}.`
      : `Espaço ${dados.codigo} atualizado.`,
    'success',
  );
}

async function gravarEspacoNaApi(dados: DadosEspaco): Promise<void> {
  if (espacoEmEdicao) {
    const casaId = ID_REAL_ESPACO[espacoEmEdicao];
    if (!casaId) throw new Error('Espaço sem vínculo com o cadastro; recarregue a página.');
    await atualizarEspaco(casaId, dados);
  } else {
    await criarEspaco(dados);
  }

  invalidarEstado();
  await carregarEstado('manter');
}

/* ===========================================================================
   Reservas
   =========================================================================== */

function renderizarReservas(): void {
  const corpo = el('tbody-reservas');
  if (!corpo) return;

  const base = reservasVigentes();
  const pendentes = base.filter((r) => r.status === 'pendente').length;
  atualizarBadgePendentes(pendentes);

  pintarStats('stats-reservas', [
    { icone: 'calendar-days', numero: base.length, rotulo: 'Em aberto' },
    { icone: 'clock', numero: pendentes, rotulo: 'Aguardando aprovação', tom: 'busy' },
    { icone: 'circle-check', numero: base.filter((r) => r.status === 'ativa').length, rotulo: 'Aprovadas', tom: 'ok' },
    { icone: 'ban', numero: reservas.filter((r) => r.status === 'cancelada').length, rotulo: 'Canceladas', tom: 'down' },
  ]);

  const termo = buscaReservas.trim().toLowerCase();
  const filtrando = Boolean(termo) || filtroReservas !== 'todas';

  const linhas = base
    .filter((r) => filtroReservas === 'todas' || r.status === filtroReservas)
    .filter((r) => {
      if (!termo) return true;
      const estufa = ESTUFAS[r.estufaId];
      return (
        r.id.toLowerCase().includes(termo)
        || r.projeto.toLowerCase().includes(termo)
        || (estufa?.nome ?? r.estufaId).toLowerCase().includes(termo)
        || (estufa?.codigo ?? '').toLowerCase().includes(termo)
        || (r.pesquisador ?? '').toLowerCase().includes(termo)
      );
    });

  atualizarContador('conta-reservas', linhas.length, base.length, filtrando);

  if (!linhas.length) {
    corpo.innerHTML = linhaVazia(
      8,
      'calendar-x',
      termo
        ? `Nenhuma reserva corresponde a “${buscaReservas}”.`
        : 'Nenhuma reserva neste filtro.',
    );
    return;
  }

  corpo.innerHTML = juntar(linhas.map((r) => linhaDeReserva(r)));
}

function linhaDeReserva(r: Reserva): string {
  const estufa = ESTUFAS[r.estufaId];
  const nome = estufa ? `${estufa.codigo} — ${estufa.nome}` : r.estufaId;
  const aprovar = r.status === 'pendente';

  return html`
    <tr class="${raw(aprovar ? 'is-pending' : '')}">
      <td data-label="Código"><span class="code">${r.id}</span></td>
      <td data-label="Espaço" class="table__name">${nome}</td>
      <td data-label="Responsável">
        ${raw(r.pesquisador
          ? html`<span class="who">${avatar(r.pesquisador)}${r.pesquisador}</span>`
          : html`<span class="table__muted">não informado</span>`)}
      </td>
      <td data-label="Quantidade">${capacidade(r.quantidade, estufa?.unidade ?? 'VASO')}</td>
      <td data-label="Projeto" class="table__truncate" title="${r.projeto}">
        ${raw(r.projeto ? html`${r.projeto}` : html`<span class="table__muted">&mdash;</span>`)}
      </td>
      <td data-label="Período" style="white-space:nowrap">
        ${dataBR(r.data)} a ${dataBR(r.dataFim)}
      </td>
      <td data-label="Status">${statusPill(r.status)}</td>
      <td data-label="Ações">
        <div class="table__actions">
          ${raw(aprovar
            ? html`<button type="button" class="btn btn--primary btn--sm"
                    data-action="aprovar-reserva" data-id="${r.id}">
                    ${icone('check', 'ic ic--sm')}Aprovar
                  </button>`
            : '')}
          ${raw(r.status !== 'cancelada'
            ? html`<button type="button" class="btn btn--quiet btn--sm btn--icon"
                    data-action="editar-reserva" data-id="${r.id}"
                    aria-label="Editar a reserva ${r.id} de ${nome}">
                    ${icone('wrench', 'ic ic--sm')}
                  </button>`
            : '')}
          <button type="button" class="btn btn--danger btn--sm btn--icon"
                  data-action="cancelar-reserva" data-id="${r.id}"
                  aria-label="Cancelar a reserva ${r.id} de ${nome}">
            ${icone('x', 'ic ic--sm')}
          </button>
        </div>
      </td>
    </tr>`;
}

function atualizarBadgePendentes(total: number): void {
  for (const id of ['badge-pendentes', 'badge-pendentes-topo']) pintarBadge(id, total);
}

/** Contador do chip: some quando é zero, para não virar enfeite. */
function pintarBadge(id: string, total: number): void {
  const badge = el(id);
  if (!badge) return;
  badge.textContent = String(total);
  show(badge, total > 0);
}

/**
 * Aprova a reserva pendente. O back-end confere a capacidade de novo antes de
 * ativar: o que sobrava quando o pedido entrou pode já ter sido tomado.
 */
export async function aprovarReserva(id: string): Promise<void> {
  const reserva = reservas.find((r) => r.id === id);
  if (!reserva || reserva.status !== 'pendente') return;

  try {
    const real = ID_REAL_RESERVA[id];
    if (!real) throw new Error('Reserva sem vínculo com o cadastro; recarregue a página.');

    await apiAprovar(real);
    invalidarEstado();
    await carregarEstado('manter');
  } catch (erro) {
    aviso(erro instanceof Error ? erro.message : 'Não foi possível aprovar.', 'error');
    return;
  }

  dadosMudaram();
  aviso(`Reserva ${id} aprovada.`, 'success');
}

export async function cancelarReserva(id: string): Promise<void> {
  const reserva = reservas.find((r) => r.id === id);
  if (!reserva) return;

  const estufa = ESTUFAS[reserva.estufaId];
  const nome = estufa ? `${estufa.codigo} — ${estufa.nome}` : reserva.estufaId;

  const ok = await confirmar({
    titulo: 'Cancelar esta reserva?',
    mensagem: html`
      A reserva <strong>${reserva.id}</strong> de ${nome}
      (${capacidade(reserva.quantidade, estufa?.unidade ?? 'VASO')}, a partir de
      ${dataBR(reserva.data)}) sai da agenda e a capacidade volta a ficar
      disponível. Não é possível desfazer.`,
    icone: 'calendar-x',
    confirmar: 'Cancelar reserva',
    cancelar: 'Voltar',
    perigo: true,
  });
  if (!ok) return;

  try {
    await cancelarNoDestino(reserva.id);
  } catch (erro) {
    aviso(erro instanceof Error ? erro.message : 'Não foi possível cancelar.', 'error');
    return;
  }

  dadosMudaram();
  aviso(`Reserva ${reserva.id} cancelada.`, 'info');
}

export function buscarReservas(termo: string): void {
  buscaReservas = termo;
  show(el('limpar-reservas'), Boolean(termo));
  renderizarReservas();
}

export function filtrarReservas(status: FiltroReserva, botao?: HTMLElement): void {
  filtroReservas = status;
  for (const chip of qsa('[data-action="filtrar-reservas"]')) {
    chip.setAttribute('aria-selected', String(chip === botao || chip.dataset.status === status));
  }
  renderizarReservas();
}

/* ===========================================================================
   Usuários
   =========================================================================== */

async function atualizarUsuariosDaApi(): Promise<void> {
  try {
    await recarregarUsuarios();
    renderizarUsuarios();
  } catch (erro) {
    console.warn('[CVGWeb] não foi possível ler os usuários da API:', erro);
  }
}

/**
 * Lista de usuários em tabela.
 *
 * Eram cartões com nome, cargo e login — bonito com dez pessoas, inútil com
 * duzentas: não mostrava e-mail nem matrícula, não dizia se o acesso estava
 * ativo e não tinha como procurar ninguém. Tabela com busca e filtros resolve
 * as três coisas e lê igual à de reservas.
 */
function renderizarUsuarios(): void {
  const corpo = el('tbody-usuarios');
  if (!corpo) return;

  const todos = listarUsuarios();
  const eu = usuarioAtual();

  const semSenha = todos.filter((u) => u.situacao === 'CONVITE_PENDENTE');
  pintarBadge('badge-sem-senha', semSenha.length);

  // Convite que não chegou é o que pede ação do administrador: reenviar.
  const semEmail = semSenha.filter((u) => u.convite && u.convite.estado !== 'ENVIADO').length;
  pintarStats('stats-usuarios', [
    { icone: 'users', numero: todos.length, rotulo: 'Usuários' },
    { icone: 'shield-user', numero: todos.filter((u) => u.admin).length, rotulo: 'Administradores', tom: 'booked' },
    { icone: 'clock', numero: semSenha.length, rotulo: 'Aguardando criar a senha', tom: 'busy' },
    { icone: 'send-horizontal', numero: semEmail, rotulo: 'Convites que não chegaram', tom: semEmail ? 'down' : undefined },
  ]);

  const termo = buscaUsuarios.trim().toLowerCase();
  const filtrando = Boolean(termo) || filtroUsuarios !== 'todos';

  const linhas = todos
    .filter((u) => cabeNoFiltroDeUsuario(u))
    .filter((u) => !termo || [u.nome, u.email, u.login, u.matricula, u.cargo]
      .some((campo) => (campo ?? '').toLowerCase().includes(termo)));

  atualizarContador('conta-usuarios', linhas.length, todos.length, filtrando);

  if (!linhas.length) {
    corpo.innerHTML = linhaVazia(
      9,
      'users',
      termo
        ? `Nenhum usuário corresponde a “${buscaUsuarios}”.`
        : 'Nenhum usuário neste filtro.',
    );
    return;
  }

  corpo.innerHTML = juntar(linhas.map((u) => linhaDeUsuario(u, eu)));
}

function cabeNoFiltroDeUsuario(u: Usuario): boolean {
  switch (filtroUsuarios) {
    case 'admin':
      return u.admin;
    case 'pesquisador':
      return !u.admin;
    case 'sem-senha':
      return u.situacao === 'CONVITE_PENDENTE';
    case 'inativo':
      return u.situacao === 'INATIVO';
    default:
      return true;
  }
}

function linhaDeUsuario(u: Usuario, eu: Usuario | null): string {
  const souEu = eu?.id === u.id;
  const semSenha = u.situacao === 'CONVITE_PENDENTE';
  const inativo = u.situacao === 'INATIVO';
  // Um admin remove pesquisadores e a própria conta, nunca outro admin.
  const podeExcluir = !u.admin || souEu;
  const vazio = html`<span class="table__muted">&mdash;</span>`;

  return html`
    <tr class="${raw(inativo ? 'is-off' : '')}">
      <td data-label="Nome completo">
        <div class="who">
          ${avatar(u.nome)}
          <div class="table__stack">
            <span class="table__name">
              ${u.nome}
              ${raw(souEu ? html`<span class="pill pill--ok">você</span>` : '')}
            </span>
            ${raw(u.projetos
              ? html`<span class="table__sub">
                       ${String(u.projetos)} ${u.projetos === 1 ? 'projeto' : 'projetos'}
                     </span>`
              : '')}
          </div>
        </div>
      </td>
      <td data-label="E-mail" class="table__truncate" title="${u.email ?? ''}">
        ${raw(u.email ? html`<span class="cell-icon">${icone('send-horizontal', 'ic ic--sm')}${u.email}</span>` : vazio)}
      </td>
      <td data-label="Usuário"><span class="code">${u.login}</span></td>
      <td data-label="Matrícula">${raw(u.matricula ? html`${u.matricula}` : vazio)}</td>
      <td data-label="Cargo">${raw(u.cargo ? html`${u.cargo}` : vazio)}</td>
      <td data-label="Perfil">
        <span class="pill ${raw(u.admin ? 'pill--booked' : 'pill--neutral')}">
          ${icone(u.admin ? 'shield-user' : 'user', 'ic ic--sm')}${u.admin ? 'Administrador' : 'Pesquisador'}
        </span>
      </td>
      <td data-label="Situação">${raw(pillDoAcesso(u))}</td>
      <td data-label="Último acesso" style="white-space:nowrap">
        ${raw(u.ultimoAcesso
          ? html`${dataHoraBR(u.ultimoAcesso)}`
          : html`<span class="table__muted">nunca entrou</span>`)}
      </td>
      <td data-label="Ações">
        <div class="table__actions">
          ${raw(semSenha
            ? html`<button type="button" class="btn btn--quiet btn--sm"
                    data-action="reenviar-convite" data-id="${u.id}"
                    title="${u.convite?.mensagem ?? 'Reenviar o link de criação de senha'}">
                    ${icone('send-horizontal', 'ic ic--sm')}Reenviar convite
                  </button>`
            : '')}
          <button type="button" class="btn btn--quiet btn--sm btn--icon"
                  data-action="editar-usuario" data-id="${u.id}"
                  aria-label="Editar ${u.nome}">
            ${icone('wrench', 'ic ic--sm')}
          </button>
          ${raw(!souEu
            ? html`<button type="button" class="btn btn--quiet btn--sm btn--icon"
                    data-action="alternar-acesso" data-id="${u.id}" data-ativo="${String(!inativo)}"
                    title="${inativo ? 'Reativar o acesso' : 'Desativar o acesso'}"
                    aria-label="${inativo ? 'Reativar' : 'Desativar'} o acesso de ${u.nome}">
                    ${icone(inativo ? 'circle-check' : 'ban', 'ic ic--sm')}
                  </button>`
            : '')}
          ${raw(podeExcluir
            ? html`<button type="button" class="btn btn--danger btn--sm btn--icon"
                    data-action="excluir-usuario" data-id="${u.id}"
                    aria-label="Excluir ${souEu ? 'minha conta' : u.nome}">
                    ${icone('trash-2', 'ic ic--sm')}
                  </button>`
            : '')}
        </div>
      </td>
    </tr>`;
}

/** Situação do acesso: ativo, cadastrado sem senha criada, ou desativado. */
function pillDoAcesso(u: Usuario): string {
  if (u.situacao === 'INATIVO') {
    return html`<span class="pill pill--down">${icone('ban', 'ic ic--sm')}Inativo</span>`;
  }

  if (u.situacao === 'CONVITE_PENDENTE') {
    // "Sem senha" tem três histórias diferentes, e só uma delas é esperar.
    const estado = u.convite?.estado;
    const dica = u.convite?.mensagem ?? '';

    if (estado === 'NAO_ENVIADO' || estado === 'SEM_CONVITE') {
      return html`<span class="pill pill--down" title="${dica}">${icone('circle-x', 'ic ic--sm')}Sem senha · e-mail não saiu</span>`;
    }

    if (estado === 'VENCIDO') {
      return html`<span class="pill pill--down" title="${dica}">${icone('clock', 'ic ic--sm')}Sem senha · convite vencido</span>`;
    }

    return html`<span class="pill pill--busy" title="${dica}">${icone('clock', 'ic ic--sm')}Sem senha · convite enviado</span>`;
  }

  return html`<span class="pill pill--ok">${icone('circle-check', 'ic ic--sm')}Ativo</span>`;
}

export function buscarUsuarios(termo: string): void {
  buscaUsuarios = termo;
  show(el('limpar-usuarios'), Boolean(termo));
  renderizarUsuarios();
}

export function filtrarUsuarios(filtro: FiltroUsuario): void {
  filtroUsuarios = filtro;
  for (const chip of qsa('[data-action="filtrar-usuarios"]')) {
    chip.setAttribute('aria-selected', String(chip.dataset.filtro === filtro));
  }
  renderizarUsuarios();
}

export function abrirNovoUsuario(): void {
  perfilNovoUsuario = 'pesquisador';

  el<HTMLFormElement>('form-novo-usuario')?.reset();
  for (const id of ['novo-usuario-nome', 'novo-usuario-email', 'novo-usuario-nick']) {
    el<HTMLInputElement>(id)?.removeAttribute('aria-invalid');
  }
  show(el('novo-usuario-erro'), false);
  marcarPerfilNovoUsuario('pesquisador');
  prepararCargos('novo-usuario-cargo');

  abrirModal('modal-novo-usuario');

  el<HTMLInputElement>('novo-usuario-nome')?.focus();
}

export function definirPerfilNovoUsuario(perfil: PerfilUsuario): void {
  perfilNovoUsuario = perfil;
  marcarPerfilNovoUsuario(perfil);
}

function marcarPerfilNovoUsuario(perfil: PerfilUsuario): void {
  for (const opcao of qsa('#novo-usuario-perfil [data-role]')) {
    const ativo = opcao.dataset.role === perfil;
    opcao.setAttribute('aria-checked', String(ativo));
    opcao.tabIndex = ativo ? 0 : -1;
  }
}

export async function confirmarNovoUsuario(): Promise<void> {
  const campoNome = el<HTMLInputElement>('novo-usuario-nome');
  const campo = el<HTMLInputElement>('novo-usuario-email');
  const botao = el<HTMLButtonElement>('novo-usuario-enviar');

  // O nome é digitado, não deduzido do e-mail: é ele que aparece na lista de
  // usuários e nas reservas.
  if (!(campoNome?.value ?? '').trim()) {
    campoNome?.setAttribute('aria-invalid', 'true');
    setText('novo-usuario-erro-texto', 'Informe o nome completo da pessoa.');
    show(el('novo-usuario-erro'), true);
    campoNome?.focus();
    return;
  }
  campoNome?.removeAttribute('aria-invalid');

  if (botao) botao.disabled = true;

  const cargo = el<HTMLSelectElement>('novo-usuario-cargo')?.value ?? '';

  const resultado = await cadastrarUsuario(
    campo?.value ?? '',
    perfilNovoUsuario,
    campoNome?.value ?? '',
    {
      nick: el<HTMLInputElement>('novo-usuario-nick')?.value ?? '',
      matricula: el<HTMLInputElement>('novo-usuario-matricula')?.value ?? '',
      cargoId: cargo ? Number(cargo) : null,
    },
  );

  if (botao) botao.disabled = false;

  if (!resultado.ok) {
    campo?.setAttribute('aria-invalid', 'true');
    setText('novo-usuario-erro-texto', resultado.erro ?? 'Não foi possível cadastrar.');
    show(el('novo-usuario-erro'), true);
    campo?.focus();
    return;
  }

  campo?.removeAttribute('aria-invalid');
  show(el('novo-usuario-erro'), false);
  renderizarUsuarios();
  fecharModal(el('modal-novo-usuario'));

  // O cadastro deu certo, mas o e-mail não saiu: em vez de um aviso que some,
  // um diálogo com o motivo e o link para entregar à pessoa.
  if (resultado.convite && !resultado.convite.enviado) {
    await mostrarLinkDoConvite(resultado.usuario?.nome ?? 'a pessoa', resultado.convite, 'Cadastro feito');
    return;
  }

  // A mensagem do back-end diz para onde o convite foi.
  aviso(
    resultado.mensagem
      ?? `${resultado.usuario?.nome ?? 'Usuário'} cadastrado; o convite de acesso foi enviado.`,
    'success',
  );
}

/**
 * O e-mail do convite não saiu. O link continua valendo, então o administrador
 * fica com ele na mão: o diálogo explica o que houve (rede, conta de e-mail em
 * modo de teste, chave...) e copia o link para mandar por outro canal.
 */
async function mostrarLinkDoConvite(nome: string, convite: EnvioDoConvite, titulo: string): Promise<void> {
  if (!convite.link) {
    aviso(convite.mensagem ?? 'O e-mail do convite não saiu.', 'error');
    return;
  }

  const copiar = await confirmar({
    titulo: `${titulo}, mas o e-mail não saiu`,
    mensagem: html`${convite.mensagem ?? 'O servidor não conseguiu enviar o e-mail.'}
      <br /><br />O link abaixo é o mesmo do convite e vale por 48 horas: entregue-o a
      <strong>${nome}</strong> por outro canal${convite.pode_tentar_de_novo ? ', ou tente reenviar daqui a pouco' : ''}.
      <input class="linkbox" type="text" readonly value="${convite.link}" aria-label="Link do convite" />`,
    icone: 'send-horizontal',
    confirmar: 'Copiar link',
    cancelar: 'Fechar',
  });

  if (!copiar) return;

  try {
    await navigator.clipboard.writeText(convite.link);
    aviso('Link copiado. Entregue-o à pessoa para ela criar a senha.', 'success');
  } catch {
    // Sem permissão de área de transferência (http, aba em segundo plano).
    window.prompt('Copie o link do convite:', convite.link);
  }
}

/** Aviso do topo da tela de usuários, com o que o servidor sabe do e-mail. */
async function atualizarAvisoDoEmail(): Promise<void> {
  const caixa = el('aviso-email');
  const lista = el('aviso-email-lista');
  if (!caixa || !lista) return;

  try {
    const situacao = await getSituacaoDoEmail();
    lista.innerHTML = juntar(situacao.avisos.map((texto) => html`<li>${texto}</li>`));
    show(caixa, !situacao.pronto);
  } catch {
    // Sem a resposta, não afirma nada: melhor sem aviso que um aviso errado.
    show(caixa, false);
  }
}

/* ===========================================================================
   Edição de usuário

   `PUT /api/funcionarios/{id}` sempre existiu sem tela: um nome ou um e-mail
   digitado errado era permanente, e corrigir pelo caminho de excluir e
   recadastrar não funciona — o back-end recusa excluir quem já tem reserva.
   =========================================================================== */

export function abrirEditarUsuario(id: string): void {
  const usuario = listarUsuarios().find((u) => u.id === id);
  if (!usuario) return;

  usuarioEmEdicao = id;
  perfilEdicao = usuario.admin ? 'admin' : 'pesquisador';

  setText('editar-usuario-titulo', usuario.nome);
  setText(
    'editar-usuario-desc',
    `${usuario.login}${usuario.matricula ? ` · matrícula ${usuario.matricula}` : ''}`,
  );

  const situacao = el('editar-usuario-situacao');
  if (situacao) situacao.innerHTML = pillDoAcesso(usuario);

  setText(
    'editar-usuario-acesso',
    usuario.ultimoAcesso ? dataHoraBR(usuario.ultimoAcesso) : 'nunca entrou',
  );
  setText(
    'editar-usuario-projetos',
    usuario.projetos
      ? `${usuario.projetos} ${usuario.projetos === 1 ? 'equipe' : 'equipes'}`
      : 'nenhuma',
  );

  definirCampo('editar-usuario-nome', usuario.nome);
  definirCampo('editar-usuario-email', usuario.email ?? '');
  definirCampo('editar-usuario-nick', usuario.login);
  definirCampo('editar-usuario-matricula', usuario.matricula ?? '');
  prepararCargos('editar-usuario-cargo', usuario.cargoId);

  marcarPerfilEdicao(perfilEdicao);
  show(el('editar-usuario-erro'), false);

  abrirModal('modal-usuario-editar');

  el<HTMLInputElement>('editar-usuario-nome')?.focus();
}

function definirCampo(id: string, valor: string): void {
  const campo = el<HTMLInputElement>(id);
  if (campo) campo.value = valor;
}

export function definirPerfilEdicao(perfil: PerfilUsuario): void {
  perfilEdicao = perfil;
  marcarPerfilEdicao(perfil);
}

function marcarPerfilEdicao(perfil: PerfilUsuario): void {
  for (const opcao of qsa('#editar-usuario-perfil [data-papel]')) {
    opcao.setAttribute('aria-checked', String(opcao.dataset.papel === perfil));
  }
}

export async function confirmarEdicaoUsuario(): Promise<void> {
  if (!usuarioEmEdicao) return;

  const botao = el<HTMLButtonElement>('editar-usuario-enviar');
  if (botao) botao.disabled = true;

  const cargo = el<HTMLSelectElement>('editar-usuario-cargo')?.value ?? '';

  const resultado = await editarUsuario(usuarioEmEdicao, {
    nome: el<HTMLInputElement>('editar-usuario-nome')?.value ?? '',
    email: el<HTMLInputElement>('editar-usuario-email')?.value ?? '',
    nick: el<HTMLInputElement>('editar-usuario-nick')?.value ?? '',
    matricula: el<HTMLInputElement>('editar-usuario-matricula')?.value ?? '',
    cargoId: cargo ? Number(cargo) : null,
    admin: perfilEdicao === 'admin',
  });

  if (botao) botao.disabled = false;

  if (!resultado.ok) {
    setText('editar-usuario-erro-texto', resultado.erro ?? 'Não foi possível salvar.');
    show(el('editar-usuario-erro'), true);
    return;
  }

  const nome = resultado.usuario?.nome ?? 'Usuário';
  usuarioEmEdicao = null;
  show(el('editar-usuario-erro'), false);

  fecharModal(el('modal-usuario-editar'));
  renderizarUsuarios();
  dadosMudaram();

  aviso(`${nome} salvo.`, 'success');
}

/** Convites em envio agora: segura o clique duplo no mesmo botão. */
const convitesEmEnvio = new Set<string>();

export async function reenviarConviteDoUsuario(id: string): Promise<void> {
  if (convitesEmEnvio.has(id)) return;
  convitesEmEnvio.add(id);

  const botao = document.querySelector<HTMLButtonElement>(`[data-action="reenviar-convite"][data-id="${id}"]`);
  if (botao) {
    botao.disabled = true;
    botao.setAttribute('aria-busy', 'true');
  }
  aviso('Enviando o convite…', 'info');

  const resultado = await reenviarConviteUsuario(id).finally(() => convitesEmEnvio.delete(id));

  renderizarUsuarios();

  if (!resultado.ok) {
    aviso(resultado.erro ?? 'Não foi possível enviar o convite.', 'error');
    return;
  }

  if (resultado.convite && !resultado.convite.enviado) {
    const nome = listarUsuarios().find((u) => u.id === id)?.nome ?? 'a pessoa';
    await mostrarLinkDoConvite(nome, resultado.convite, 'Link gerado');
    return;
  }

  aviso(resultado.mensagem ?? 'Convite enviado.', 'success');
}

export async function alternarAcesso(id: string, estaAtivo: boolean): Promise<void> {
  const usuario = listarUsuarios().find((u) => u.id === id);
  if (!usuario) return;

  const desativando = estaAtivo;
  const ok = await confirmar({
    titulo: desativando ? 'Desativar este acesso?' : 'Reativar este acesso?',
    mensagem: desativando
      ? html`<strong>${usuario.nome}</strong> deixa de entrar no sistema, mas o
             histórico de reservas é preservado. As sessões abertas caem.`
      : html`<strong>${usuario.nome}</strong> volta a poder entrar no sistema.`,
    icone: desativando ? 'ban' : 'circle-check',
    confirmar: desativando ? 'Desativar' : 'Reativar',
    perigo: desativando,
  });
  if (!ok) return;

  const resultado = await alternarAcessoUsuario(id, !estaAtivo);

  if (!resultado.ok) {
    aviso(resultado.erro ?? 'Não foi possível alterar o acesso.', 'error');
    return;
  }

  renderizarUsuarios();
  aviso(desativando ? 'Acesso desativado.' : 'Acesso reativado.', 'info');
}

export async function pedirExclusaoUsuario(
  id: string,
  aoSairDaPropriaConta: () => void,
): Promise<void> {
  const usuario = listarUsuarios().find((u) => u.id === id);
  if (!usuario) return;

  const souEu = usuarioAtual()?.id === id;
  const ok = await confirmar({
    titulo: souEu ? 'Excluir sua conta?' : 'Excluir este usuário?',
    mensagem: souEu
      ? html`A conta <strong>${usuario.nome}</strong> é removida e a sessão
             termina agora. Não é possível desfazer.`
      : html`<strong>${usuario.nome}</strong> perde o acesso ao sistema.
             Quem tem reservas registradas não pode ser excluído — nesse caso,
             desative o acesso. Não é possível desfazer.`,
    icone: 'user-x',
    confirmar: 'Excluir',
    perigo: true,
  });
  if (!ok) return;

  const resultado = await excluirUsuario(id);
  if (!resultado.ok) {
    aviso(resultado.erro ?? 'Não foi possível excluir.', 'error');
    return;
  }

  if (resultado.eraEuMesmo) {
    fecharTodosModais();
    aoSairDaPropriaConta();
    return;
  }

  renderizarUsuarios();
  aviso(`${usuario.nome} foi removido do sistema.`, 'info');
}

/* ===========================================================================
   Navegação interna
   =========================================================================== */

export function irPara(destino: string): void {
  fecharTodosModais();

  if (destino.startsWith('reservas')) {
    const status = destino.split('-')[1] as FiltroReserva | undefined;
    filtrarReservas(status ?? 'todas');
    irParaSecao('reservas');
    return;
  }

  irParaSecao('admin');

  const secao = el('sec-espacos');
  if (!secao) return;
  secao.scrollIntoView({ behavior: 'smooth', block: 'start' });
  secao.classList.add('is-flash');
  window.setTimeout(() => secao.classList.remove('is-flash'), 900);
}

export function abrirPainelMetricas(): void {
  renderizarMetricas();
  void atualizarMetricasDaApi();
  abrirModal('modal-metricas');
}

/** Entrada da seção de reservas: a casca chama ao mostrar a tela. */
export function mostrarReservas(status?: FiltroReserva): void {
  filtrarReservas(status ?? filtroReservas);
}

/** Entrada da seção de usuários: desenha o que há e relê do back-end. */
export function mostrarUsuarios(): void {
  renderizarUsuarios();
  void atualizarUsuariosDaApi();
  void atualizarAvisoDoEmail();
}

/* ===========================================================================
   Auxiliares
   =========================================================================== */

function atualizarContador(
  id: string,
  mostrados: number,
  total: number,
  filtrando: boolean,
): void {
  setText(id, filtrando && mostrados !== total ? `${mostrados} de ${total}` : String(total));
}

function linhaVazia(colunas: number, simbolo: string, mensagem: string): string {
  return html`
    <tr class="table__empty">
      <td colspan="${colunas}">
        <div class="empty">
          ${icone(simbolo, 'ic ic--xl')}
          <p class="empty__text">${mensagem}</p>
        </div>
      </td>
    </tr>`;
}

/** Reaplica a busca visível quando a tabela é redesenhada de fora. */
export function limparBusca(qual: 'espacos' | 'reservas' | 'usuarios'): void {
  const campo = el<HTMLInputElement>(`busca-${qual}`);
  if (campo) {
    campo.value = '';
    campo.focus();
  }

  if (qual === 'espacos') buscarEspacos('');
  else if (qual === 'reservas') buscarReservas('');
  else buscarUsuarios('');
}
