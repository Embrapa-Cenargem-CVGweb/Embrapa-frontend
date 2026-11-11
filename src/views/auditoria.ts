/**
 * Histórico de alterações (auditoria).
 *
 * A trilha é a única tabela do sistema que só cresce, e é a única tela onde a
 * paginação do back-end é usada de verdade: nada de pedir 500 registros e
 * desenhar o que vier. Página de 30, com `current_page`/`last_page` vindos do
 * paginador do Laravel.
 *
 * Quem vê o quê é decidido no back-end: o adm vê tudo, e quem recebeu
 * `auditoria.ver` em um projeto vê só os registros daquele projeto. Por isso os
 * filtros não são montados a partir do cadastro inteiro — vêm de
 * `/auditorias/filtros`, que lista apenas o que aparece na trilha visível a
 * esta pessoa. Oferecer um nome que nunca alterou nada seria um filtro que
 * sempre volta vazio.
 *
 * Não há busca por texto: a API não tem esse filtro, e um campo que procurasse
 * só dentro da página carregada mentiria sobre o que existe.
 *
 * É uma aba da navegação, não um modal: a trilha é uma tela de consulta, com
 * filtro e paginação, que se percorre — e não um recado que se fecha.
 */
import { el, setText, show } from '../lib/dom';
import { html, icone, juntar, raw } from '../lib/html';
import { dataHoraBR } from '../lib/format';
import { avatar } from '../lib/telas';
import { aviso } from '../lib/toast';
import { statusDoErro } from './falha';
import {
  getAuditoria,
  getFiltrosAuditoria,
  type FiltrosAuditoria,
  type PaginaAuditoria,
  type RegistroAuditoria,
} from '../services/api';

/** Nome das entidades como a pessoa as conhece, não como a classe se chama. */
const ENTIDADE_ROTULO: Record<string, string> = {
  CasaVegetacao: 'Casa de vegetação',
  Reserva: 'Reserva',
  Projeto: 'Projeto',
  EquipeProjeto: 'Equipe do projeto',
  ColaboradorProjeto: 'Equipe do projeto',
  Funcionario: 'Funcionário',
  Cargo: 'Cargo',
  StatusProjeto: 'Status de projeto',
  ConviteAcesso: 'Convite de acesso',
  Sessao: 'Acesso ao sistema',
  Acesso: 'Tentativa sem permissão',
  Assistente: 'Pergunta ao assistente',
};

/** Campos como a tela os chama. O que não estiver aqui aparece como veio. */
const CAMPO_ROTULO: Record<string, string> = {
  capacidade_total: 'capacidade',
  unidade_capacidade: 'unidade',
  data_inicio: 'início',
  data_fim: 'fim',
  casa_vegetacao_id: 'espaço',
  projeto_id: 'projeto',
  funcionario_id: 'responsável',
  status_projeto_id: 'situação',
  cargo_id: 'cargo',
  aprovada_em: 'aprovada em',
  aprovada_por: 'aprovada por',
  motivo_cancelamento: 'motivo do cancelamento',
  senha_definida_em: 'senha definida em',
  convite_enviado_em: 'convite enviado em',
  ultimo_acesso_em: 'último acesso',
  permissoes: 'permissões',
  password: 'senha',
  area_m2: 'área',
  localizacao: 'setor',
};

/**
 * Cada ação da trilha: como se lê, com que cor e com que ícone. A lista
 * acompanha as constantes de App\Models\Auditoria no back-end; uma ação que
 * não estiver aqui aparece com o próprio nome, em cinza.
 */
const ACOES: Record<string, { rotulo: string; pill: string; icone: string }> = {
  CRIOU: { rotulo: 'Criou', pill: 'pill--booked', icone: 'plus' },
  ALTEROU: { rotulo: 'Alterou', pill: 'pill--busy', icone: 'wrench' },
  EXCLUIU: { rotulo: 'Excluiu', pill: 'pill--down', icone: 'trash-2' },
  ENTROU: { rotulo: 'Entrou', pill: 'pill--ok', icone: 'log-in' },
  SAIU: { rotulo: 'Saiu', pill: 'pill--neutral', icone: 'log-out' },
  FALHOU: { rotulo: 'Falhou', pill: 'pill--down', icone: 'circle-x' },
  NEGADO: { rotulo: 'Acesso negado', pill: 'pill--down', icone: 'ban' },
  ENVIOU: { rotulo: 'Enviou e-mail', pill: 'pill--booked', icone: 'send-horizontal' },
  PEDIU_SENHA: { rotulo: 'Pediu nova senha', pill: 'pill--busy', icone: 'clock' },
  DEFINIU_SENHA: { rotulo: 'Definiu a senha', pill: 'pill--ok', icone: 'shield-check' },
  APROVOU: { rotulo: 'Aprovou', pill: 'pill--ok', icone: 'circle-check' },
  CANCELOU: { rotulo: 'Cancelou', pill: 'pill--down', icone: 'calendar-x' },
  ATIVOU: { rotulo: 'Reativou acesso', pill: 'pill--ok', icone: 'user-plus' },
  DESATIVOU: { rotulo: 'Desativou acesso', pill: 'pill--down', icone: 'user-x' },
  PERGUNTOU: { rotulo: 'Perguntou', pill: 'pill--neutral', icone: 'message-circle' },
};

function acaoDe(codigo: string): { rotulo: string; pill: string; icone: string } {
  return ACOES[codigo] ?? {
    rotulo: codigo.charAt(0) + codigo.slice(1).toLowerCase().replace(/_/g, ' '),
    pill: 'pill--neutral',
    icone: 'info',
  };
}

/** Quantos campos alterados a célula mostra antes de resumir o resto. */
const CAMPOS_VISIVEIS = 2;

interface Filtros {
  entidade: string;
  acao: string;
  funcionario_id: string;
  projeto_id: string;
  de: string;
  ate: string;
  busca: string;
}

const VAZIO: Filtros = {
  entidade: '', acao: '', funcionario_id: '', projeto_id: '', de: '', ate: '', busca: '',
};

let filtros: Filtros = { ...VAZIO };
let pagina: PaginaAuditoria | null = null;
let catalogo: FiltrosAuditoria | null = null;
let paginaAtual = 1;
let carregando = false;
/** Código HTTP da última falha, para a tabela dizer o que aconteceu. */
let ultimoErro: number | null = null;

/** Chamado toda vez que a aba entra em cena. */
export function renderizarHistorico(): void {
  // Primeira visita da sessão: começa sem recorte. Nas seguintes, mantém o
  // filtro de quem estava investigando algo e só saiu da aba um instante.
  if (!pagina) {
    filtros = { ...VAZIO };
    paginaAtual = 1;
  }

  // As opções dos filtros são o que já apareceu na trilha, e ela cresce a
  // cada ação: relê a cada visita em vez de guardar a primeira resposta.
  catalogo = null;

  void carregar();
}

async function carregar(): Promise<void> {
  if (carregando) return;
  carregando = true;
  pintarCarregando();

  // O catálogo muda pouco (é o que já apareceu na trilha): lê uma vez.
  if (!catalogo) {
    catalogo = await getFiltrosAuditoria().catch(() => null);
    if (catalogo) pintarFiltros(catalogo);
  }

  ultimoErro = null;

  try {
    pagina = await getAuditoria({
      entidade: filtros.entidade || undefined,
      acao: filtros.acao || undefined,
      funcionario_id: filtros.funcionario_id ? Number(filtros.funcionario_id) : undefined,
      projeto_id: filtros.projeto_id ? Number(filtros.projeto_id) : undefined,
      de: filtros.de || undefined,
      ate: filtros.ate || undefined,
      busca: filtros.busca.trim() || undefined,
      page: paginaAtual,
    });
  } catch (erro) {
    pagina = null;
    ultimoErro = statusDoErro(erro);

    // 403 não é falha: é a permissão respondendo. A tabela explica isso no
    // lugar de um aviso que desaparece em três segundos.
    if (ultimoErro !== 403) {
      aviso(erro instanceof Error ? erro.message : 'Não foi possível ler o histórico.', 'error');
    }
  } finally {
    carregando = false;
  }

  renderizar();
}

function pintarCarregando(): void {
  const corpo = el('tbody-auditoria');
  if (!corpo || corpo.children.length) return;

  corpo.innerHTML = html`
    <tr class="table__empty">
      <td colspan="5">
        <div class="empty">
          ${icone('clock', 'ic ic--xl')}
          <p class="empty__text">Lendo o histórico&hellip;</p>
        </div>
      </td>
    </tr>`;
}

/** Enche os selects com o que existe na trilha desta pessoa. */
function pintarFiltros(dados: FiltrosAuditoria): void {
  encher('auditoria-entidade', 'Todos os registros', dados.entidades.map((e) => ({
    valor: e,
    rotulo: ENTIDADE_ROTULO[e] ?? e,
  })));

  encher('auditoria-acao', 'Qualquer ação', dados.acoes.map((a) => ({
    valor: a,
    rotulo: acaoDe(a).rotulo,
  })));

  encher('auditoria-pessoa', 'Qualquer pessoa', dados.funcionarios.map((f) => ({
    valor: String(f.id),
    rotulo: f.nick ? `${f.nome} (${f.nick})` : f.nome,
  })));

  encher('auditoria-projeto', 'Todos os projetos', dados.projetos.map((p) => ({
    valor: String(p.id),
    rotulo: `${p.codigo} — ${p.titulo}`,
  })));
}

function encher(id: string, padrao: string, opcoes: { valor: string; rotulo: string }[]): void {
  const select = el<HTMLSelectElement>(id);
  if (!select) return;

  const escolhido = select.value;

  select.innerHTML = juntar([
    html`<option value="">${padrao}</option>`,
    ...opcoes.map((o) => html`<option value="${o.valor}">${o.rotulo}</option>`),
  ]);

  // Relê sem perder a escolha de quem já tinha filtrado.
  if (escolhido) select.value = escolhido;
}

function renderizar(): void {
  const corpo = el('tbody-auditoria');
  if (!corpo) return;

  const registros = pagina?.data ?? [];
  const total = pagina?.total ?? 0;

  setText('conta-auditoria', String(total));
  pintarPaginacao();

  if (!registros.length) {
    corpo.innerHTML = html`
      <tr class="table__empty">
        <td colspan="5">
          <div class="empty">
            ${icone(ultimoErro ? 'circle-x' : 'shield-check', 'ic ic--xl')}
            <p class="empty__text">${raw(textoDoVazio())}</p>
          </div>
        </td>
      </tr>`;
    return;
  }

  corpo.innerHTML = juntar(registros.map(linha));
}

function filtrando(): boolean {
  return Object.values(filtros).some(Boolean);
}

/** A tabela vazia tem quatro motivos diferentes, e cada um pede outra frase. */
function textoDoVazio(): string {
  if (ultimoErro === 403) {
    return html`O seu acesso não alcança o histórico. A trilha é da administração,
      e de quem recebeu <strong>ver auditoria</strong> em algum projeto.`;
  }

  if (ultimoErro) {
    return html`Não foi possível ler o histórico agora (HTTP ${String(ultimoErro)}).
      Feche e abra de novo; se insistir, o motivo está no log da API.`;
  }

  if (filtrando()) {
    return html`Nenhuma alteração neste recorte. Limpe os filtros para ver o histórico inteiro.`;
  }

  return html`Nada registrado ainda. Toda alteração feita pelas telas entra aqui.`;
}

function linha(r: RegistroAuditoria): string {
  const quando = dataHoraBR(r.created_at);
  const [data, hora] = quando.split(' ');
  const acao = acaoDe(r.acao);
  // O nome guardado na hora vale mesmo sem o cadastro (pessoa removida,
  // tentativa de entrada com usuário que não existe, tarefa do sistema).
  const quem = r.funcionario?.nome ?? r.funcionario_nome ?? '';

  return html`
    <tr>
      <td data-label="Quando" class="audit-log__timestamp">
        <time datetime="${r.created_at}">${data ?? quando} ${hora ?? ''}</time>
      </td>
      <td data-label="Ação">
        <span class="pill ${raw(acao.pill)}">${icone(acao.icone, 'ic ic--sm')}${acao.rotulo}</span>
      </td>
      <td data-label="Pessoa">
        ${raw(quem
          ? html`<div class="who">
                   ${avatar(quem)}
                   <div class="table__stack">
                     <span class="table__name">${quem}</span>
                     ${raw(r.funcionario?.nick
                       ? html`<span class="table__sub">${r.funcionario.nick}</span>`
                       : r.funcionario ? '' : html`<span class="table__sub">sem cadastro</span>`)}
                   </div>
                 </div>`
          : html`<span class="table__muted">Sistema</span>`)}
      </td>
      <td data-label="Evento">
        <div class="table__stack">
          <span class="table__name">${r.rotulo ?? (r.entidade_id ? `#${String(r.entidade_id)}` : ENTIDADE_ROTULO[r.entidade] ?? r.entidade)}</span>
          <span class="table__sub">${ENTIDADE_ROTULO[r.entidade] ?? r.entidade}</span>
          ${raw(r.projeto
            ? html`<span class="audit-log__project">${r.projeto.codigo}</span>`
            : '')}
        </div>
      </td>
      <td data-label="Detalhe">
        <div class="audit-log__detail">
          ${raw(celulaDoDiff(r))}
          ${raw(r.ip ? html`<span class="audit-log__ip">IP ${r.ip}</span>` : '')}
        </div>
      </td>
    </tr>`;
}
/**
 * A célula de diff.
 *
 * Numa criação o back-end grava só o `para` de cada campo, e são muitos: listar
 * todos viraria um despejo do registro inteiro. Então criação mostra uma linha
 * de resumo, e alteração mostra de→para dos campos que mudaram.
 */
function celulaDoDiff(r: RegistroAuditoria): string {
  const alteracoes = r.alteracoes ?? {};
  const campos = Object.keys(alteracoes);

  if (!campos.length) {
    return html`<span class="table__muted">&mdash;</span>`;
  }

  if (r.acao === 'CRIOU') {
    return html`<span class="table__muted">
      registro criado com ${String(campos.length)}
      ${campos.length === 1 ? 'campo' : 'campos'}
    </span>`;
  }

  const mostrados = campos.slice(0, CAMPOS_VISIVEIS);
  const resto = campos.length - mostrados.length;

  return html`
    <div class="diff">
      ${raw(juntar(mostrados.map((campo) => linhaDoDiff(campo, alteracoes[campo]))))}
      ${raw(resto > 0
        ? html`<span class="table__sub">e ${String(resto)} ${resto === 1 ? 'outro campo' : 'outros campos'}</span>`
        : '')}
    </div>`;
}

function linhaDoDiff(campo: string, valores: { de?: unknown; para?: unknown } | undefined): string {
  const de = textoDoValor(valores?.de);
  const para = textoDoValor(valores?.para);

  return html`
    <div class="diff__item">
      <span class="diff__campo">${CAMPO_ROTULO[campo] ?? campo}</span>
      <span class="diff__valores">
        ${raw(valores && 'de' in valores
          ? html`<span class="diff__de">${de}</span>${icone('arrow-right', 'ic ic--sm diff__seta')}`
          : '')}
        <span class="diff__para">${para}</span>
      </span>
    </div>`;
}

/** Valor como a pessoa lê: vazio vira "—", booleano vira sim/não. */
function textoDoValor(valor: unknown): string {
  if (valor === null || valor === undefined || valor === '') return '—';
  if (valor === true) return 'sim';
  if (valor === false) return 'não';

  const texto = String(valor);
  return texto.length > 60 ? `${texto.slice(0, 57)}…` : texto;
}

function pintarPaginacao(): void {
  const atual = pagina?.current_page ?? 1;
  const ultima = pagina?.last_page ?? 1;
  const total = pagina?.total ?? 0;
  const porPagina = pagina?.per_page ?? 30;

  const primeiro = total ? (atual - 1) * porPagina + 1 : 0;
  const ultimo = Math.min(atual * porPagina, total);

  setText(
    'auditoria-intervalo',
    total ? `${primeiro}–${ultimo} de ${total}` : 'nenhum registro',
  );
  setText('auditoria-pagina', `página ${atual} de ${ultima}`);

  const anterior = el<HTMLButtonElement>('auditoria-anterior');
  const proxima = el<HTMLButtonElement>('auditoria-proxima');
  if (anterior) anterior.disabled = atual <= 1;
  if (proxima) proxima.disabled = atual >= ultima;

  show(el('auditoria-limpar'), filtrando());
}

/** Um filtro mudou: volta para a primeira página, senão a página 7 some. */
export function definirFiltroAuditoria(campo: string, valor: string): void {
  if (!(campo in filtros)) return;

  filtros = { ...filtros, [campo]: valor };
  paginaAtual = 1;
  void carregar();
}

export function limparFiltrosAuditoria(): void {
  filtros = { ...VAZIO };
  paginaAtual = 1;

  for (const id of ['auditoria-entidade', 'auditoria-acao', 'auditoria-pessoa', 'auditoria-projeto']) {
    const select = el<HTMLSelectElement>(id);
    if (select) select.value = '';
  }
  for (const id of ['auditoria-de', 'auditoria-ate', 'auditoria-busca']) {
    const campo = el<HTMLInputElement>(id);
    if (campo) campo.value = '';
  }

  void carregar();
}

export function paginarAuditoria(direcao: string): void {
  const atual = pagina?.current_page ?? 1;
  const ultima = pagina?.last_page ?? 1;
  const destino = direcao === 'anterior' ? atual - 1 : atual + 1;

  if (destino < 1 || destino > ultima) return;

  paginaAtual = destino;
  void carregar();
}

