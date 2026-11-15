/**
 * Logs: o que aconteceu no sistema, em ordem de tempo.
 *
 * A trilha é a única tabela do sistema que só cresce, e é a única tela onde a
 * paginação do back-end é usada de verdade: nada de pedir 500 registros e
 * desenhar o que vier. Página de 30, com `current_page`/`last_page` vindos do
 * paginador do Laravel.
 *
 * A tela era uma tabela de cinco colunas — quando, ação, pessoa, evento,
 * detalhe — e um bloco de filtros que tomava um terço da altura antes do
 * primeiro evento. As colunas repetiam a mesma informação de três jeitos e o
 * "detalhe" era quase sempre um travessão.
 *
 * Agora: filtros em uma linha (o resto atrás de "Mais filtros"), atalhos que
 * são filtros prontos com a contagem do período, e os eventos agrupados por
 * dia. Cada evento é uma FRASE — quem fez o quê — com o que mudou logo
 * abaixo, em "de → para". Clicar abre o registro inteiro sem sair da lista.
 *
 * Quem vê o quê é decidido no back-end: o adm vê tudo, e quem recebeu
 * `auditoria.ver` em um projeto vê só os registros daquele projeto. Por isso os
 * filtros não são montados a partir do cadastro inteiro — vêm de
 * `/auditorias/filtros`, que lista apenas o que aparece na trilha visível a
 * esta pessoa.
 */
import { el, qs, setText, show } from '../lib/dom';
import { html, icone, juntar, raw } from '../lib/html';
import { dataHoraBR, hojeISO } from '../lib/format';
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
  CasaVegetacao: 'Estufa',
  Reserva: 'Reserva',
  Projeto: 'Projeto',
  EquipeProjeto: 'Equipe do projeto',
  ColaboradorProjeto: 'Equipe do projeto',
  ConviteProjeto: 'Convite de projeto',
  Funcionario: 'Usuário',
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
  motivo_situacao: 'motivo',
  senha_definida_em: 'senha definida em',
  convite_enviado_em: 'convite enviado em',
  ultimo_acesso_em: 'último acesso',
  permissoes: 'permissões',
  permissoes_globais: 'permissões de sistema',
  password: 'senha',
  area_m2: 'área',
  localizacao: 'setor',
  temperatura_min: 'temperatura mínima',
  temperatura_max: 'temperatura máxima',
  vasos: 'vasos por tamanho',
};

/** Tom de cada ação: o pill, o ponto do fio do tempo e como ela se lê. */
type Tom = 'ok' | 'muda' | 'ruim' | 'atencao' | 'neutro';

const ACOES: Record<string, { rotulo: string; tom: Tom }> = {
  CRIOU: { rotulo: 'Criou', tom: 'ok' },
  ALTEROU: { rotulo: 'Alterou', tom: 'muda' },
  EXCLUIU: { rotulo: 'Excluiu', tom: 'ruim' },
  ENTROU: { rotulo: 'Entrou', tom: 'ok' },
  SAIU: { rotulo: 'Saiu', tom: 'neutro' },
  FALHOU: { rotulo: 'Não entrou', tom: 'atencao' },
  NEGADO: { rotulo: 'Sem permissão', tom: 'ruim' },
  ENVIOU: { rotulo: 'Enviou e-mail', tom: 'neutro' },
  PEDIU_SENHA: { rotulo: 'Pediu senha', tom: 'atencao' },
  DEFINIU_SENHA: { rotulo: 'Criou a senha', tom: 'ok' },
  APROVOU: { rotulo: 'Aprovou', tom: 'muda' },
  RECUSOU: { rotulo: 'Recusou', tom: 'atencao' },
  ACEITOU: { rotulo: 'Aceitou', tom: 'ok' },
  CANCELOU: { rotulo: 'Cancelou', tom: 'ruim' },
  CONVIDOU: { rotulo: 'Convidou', tom: 'neutro' },
  ATIVOU: { rotulo: 'Reativou acesso', tom: 'ok' },
  DESATIVOU: { rotulo: 'Desativou acesso', tom: 'ruim' },
  PERGUNTOU: { rotulo: 'Perguntou', tom: 'neutro' },
};

function acaoDe(codigo: string): { rotulo: string; tom: Tom } {
  return ACOES[codigo] ?? {
    rotulo: codigo.charAt(0) + codigo.slice(1).toLowerCase().replace(/_/g, ' '),
    tom: 'neutro',
  };
}

/* ===========================================================================
   A frase do evento

   O back-end guarda a ação (CRIOU), a entidade (Reserva) e um rótulo curto
   ("reserva #15", "CVG01", "lucas andrade em P-2026-001"). Alguns rótulos já
   trazem o substantivo, outros não — por isso a frase é montada por par
   ação+entidade, e não por uma regra só.
   =========================================================================== */

/** "reserva #15" vira "R015": é como a reserva aparece no resto do sistema. */
function rotuloLimpo(r: RegistroAuditoria): string {
  const bruto = (r.rotulo ?? '').trim();
  if (!bruto) return '';

  if (r.entidade === 'Reserva') {
    const so = /^reserva\s*#(\d+)$/i.exec(bruto);
    if (so) return `R${so[1].padStart(3, '0')}`;
  }
  if (r.entidade === 'Sessao' && r.acao === 'FALHOU') {
    // "Tentativa de entrada: admin@bdj.local" — o que importa é o e-mail.
    return bruto.replace(/^Tentativa de entrada:\s*/i, '');
  }
  if (r.entidade === 'ConviteAcesso') {
    return bruto.replace(/^Convite para\s*/i, '');
  }
  return bruto;
}

/** Por ação e, quando precisa, por entidade: o que vem antes do rótulo. */
const FRASES: Record<string, Record<string, string> & { padrao: string }> = {
  CRIOU: {
    padrao: 'criou',
    Reserva: 'criou a reserva',
    CasaVegetacao: 'criou a estufa',
    Projeto: 'criou o projeto',
    Funcionario: 'cadastrou',
    EquipeProjeto: 'incluiu',
    ColaboradorProjeto: 'incluiu',
  },
  ALTEROU: {
    padrao: 'alterou',
    Reserva: 'alterou a reserva',
    CasaVegetacao: 'alterou a estufa',
    Projeto: 'alterou o projeto',
    Funcionario: 'alterou o cadastro de',
    EquipeProjeto: 'mexeu na equipe —',
    ColaboradorProjeto: 'mexeu na equipe —',
  },
  EXCLUIU: {
    padrao: 'excluiu',
    Reserva: 'excluiu a reserva',
    CasaVegetacao: 'excluiu a estufa',
    Projeto: 'excluiu o projeto',
    Funcionario: 'excluiu o cadastro de',
  },
  APROVOU: { padrao: 'aprovou', Reserva: 'aprovou a reserva', Projeto: 'aprovou o projeto' },
  CANCELOU: {
    padrao: 'cancelou',
    Reserva: 'cancelou a reserva',
    ConviteProjeto: 'cancelou o convite de',
  },
  CONVIDOU: { padrao: 'convidou' },
  ACEITOU: { padrao: 'aceitou o convite —' },
  RECUSOU: { padrao: 'recusou o convite —' },
  ENVIOU: { padrao: 'enviou um convite de acesso para' },
  ATIVOU: { padrao: 'reativou o acesso de' },
  DESATIVOU: { padrao: 'desativou o acesso de' },
  PERGUNTOU: { padrao: 'perguntou ao assistente' },
};

interface Frase {
  /** Antes do alvo: "criou a reserva". */
  antes: string;
  /** Em negrito: o rótulo do registro. */
  alvo: string;
  /** Depois do alvo: "sem permissão". */
  depois: string;
}

function fraseDe(r: RegistroAuditoria): Frase {
  const alvo = rotuloLimpo(r);

  switch (r.acao) {
    case 'ENTROU':
      return { antes: 'entrou no sistema', alvo: '', depois: '' };
    case 'SAIU':
      return { antes: 'saiu do sistema', alvo: '', depois: '' };
    case 'FALHOU':
      return r.entidade === 'Sessao'
        ? { antes: 'tentou entrar como', alvo, depois: 'e a senha não conferiu' }
        : { antes: 'não conseguiu enviar o convite para', alvo, depois: '' };
    case 'NEGADO':
      return { antes: 'tentou', alvo, depois: 'sem ter permissão' };
    case 'DEFINIU_SENHA':
      return { antes: 'criou a própria senha', alvo: '', depois: '' };
    case 'PEDIU_SENHA':
      return { antes: 'pediu uma nova senha', alvo: '', depois: '' };
    case 'PERGUNTOU':
      return { antes: 'perguntou ao assistente', alvo: alvo ? `“${alvo}”` : '', depois: '' };
    default: {
      const mapa = FRASES[r.acao];
      const antes = mapa ? (mapa[r.entidade] ?? mapa.padrao) : acaoDe(r.acao).rotulo.toLowerCase();
      return { antes, alvo, depois: '' };
    }
  }
}

/* ===========================================================================
   Estado
   =========================================================================== */

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

type Periodo = 'hoje' | '7' | '30' | 'tudo' | 'custom';

let filtros: Filtros = { ...VAZIO };
let periodo: Periodo = 'tudo';
let pagina: PaginaAuditoria | null = null;
let catalogo: FiltrosAuditoria | null = null;
let paginaAtual = 1;
let carregando = false;
/** Eventos abertos (o registro inteiro aparece embaixo da frase). */
const abertos = new Set<number>();
/** Código HTTP da última falha, para a lista dizer o que aconteceu. */
let ultimoErro: number | null = null;

/** Chamado toda vez que a aba entra em cena. */
export function renderizarHistorico(): void {
  // Primeira visita da sessão: começa sem recorte. Nas seguintes, mantém o
  // filtro de quem estava investigando algo e só saiu da aba um instante.
  if (!pagina) {
    filtros = { ...VAZIO };
    periodo = 'tudo';
    paginaAtual = 1;
  }

  // As opções dos filtros são o que já apareceu na trilha, e ela cresce a
  // cada ação: relê a cada visita em vez de guardar a primeira resposta.
  catalogo = null;

  void carregar();
}

/**
 * Pré-carga logo depois do login: lê a primeira página em segundo plano, para
 * a primeira visita à tela já abrir com a trilha. Não mexe em quem já leu.
 */
export function preCarregarHistorico(): void {
  if (pagina || carregando) return;
  filtros = { ...VAZIO };
  periodo = 'tudo';
  paginaAtual = 1;
  void carregar();
}

async function carregar(): Promise<void> {
  if (carregando) return;
  carregando = true;
  pintarCarregando();

  // Filtros e página saem juntos: antes a página só era pedida depois que os
  // filtros chegavam, e a tela esperava as duas viagens em fila. O catálogo
  // também traz a contagem do período, que alimenta os atalhos.
  const periodoDoResumo = { de: filtros.de || undefined, ate: filtros.ate || undefined };
  void getFiltrosAuditoria(periodoDoResumo)
    .then((c) => {
      catalogo = c;
      pintarFiltros(c);
      pintarAtalhos();
    })
    .catch(() => undefined);

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

    // 403 não é falha: é a permissão respondendo. A lista explica isso no
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
  const lista = el('auditoria-lista');
  if (!lista || lista.children.length) return;

  lista.innerHTML = html`
    <div class="log-vazio">
      ${icone('clock', 'ic ic--xl')}
      <p>Lendo os logs&hellip;</p>
    </div>`;
}

/* ===========================================================================
   Filtros
   =========================================================================== */

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
    rotulo: f.email ? `${f.nome} (${f.email})` : f.nome,
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

/** Atalhos do topo: filtros prontos, com quantos eventos cada um tem. */
function pintarAtalhos(): void {
  const alvo = el('auditoria-atalhos');
  if (!alvo) return;

  const r = catalogo?.resumo;
  show(alvo, Boolean(r));
  if (!r) return;

  const um = (n: number, singular: string, plural: string): string => (n === 1 ? singular : plural);

  const itens = [
    { chave: '', numero: r.total, rotulo: um(r.total, 'evento no período', 'eventos no período'), tom: 'neutro', icone: 'clock' },
    { chave: 'NEGADO', numero: r.negados, rotulo: 'sem permissão', tom: 'ruim', icone: 'ban' },
    { chave: 'FALHOU', numero: r.recusados, rotulo: um(r.recusados, 'entrada recusada', 'entradas recusadas'), tom: 'atencao', icone: 'circle-x' },
    { chave: 'MUDANCAS', numero: r.mudancas, rotulo: um(r.mudancas, 'criação ou alteração', 'criações e alterações'), tom: 'muda', icone: 'wrench' },
  ];

  const atual = filtros.acao || '';
  alvo.innerHTML = juntar(itens.map((i) => html`
    <button type="button" class="log-atalho" data-tom="${i.tom}"
            aria-pressed="${String(atual === i.chave)}"
            data-action="auditoria-atalho" data-atalho="${i.chave}">
      <span class="log-atalho__icone">${icone(i.icone, 'ic ic--sm')}</span>
      <span class="log-atalho__texto">
        <strong class="log-atalho__numero">${String(i.numero)}</strong>
        <span class="log-atalho__rotulo">${i.rotulo}</span>
      </span>
    </button>`));
}

/** O que está filtrando agora, cada marca com o seu X. */
function pintarMarcas(): void {
  const alvo = el('auditoria-marcas');
  if (!alvo) return;

  const marcas: { campo: keyof Filtros | 'periodo'; texto: string }[] = [];

  if (filtros.busca.trim()) marcas.push({ campo: 'busca', texto: `Busca: “${filtros.busca.trim()}”` });
  if (filtros.acao) marcas.push({ campo: 'acao', texto: `Ação: ${acaoDe(filtros.acao).rotulo}` });
  if (filtros.funcionario_id) {
    const pessoa = catalogo?.funcionarios.find((f) => String(f.id) === filtros.funcionario_id);
    marcas.push({ campo: 'funcionario_id', texto: `Pessoa: ${pessoa?.nome ?? filtros.funcionario_id}` });
  }
  if (filtros.entidade) {
    marcas.push({ campo: 'entidade', texto: `Tipo: ${ENTIDADE_ROTULO[filtros.entidade] ?? filtros.entidade}` });
  }
  if (filtros.projeto_id) {
    const projeto = catalogo?.projetos.find((p) => String(p.id) === filtros.projeto_id);
    marcas.push({ campo: 'projeto_id', texto: `Projeto: ${projeto?.codigo ?? filtros.projeto_id}` });
  }
  // Com um período escolhido pelos chips, uma marca só, em vez de "de" e "até".
  if (periodo !== 'tudo' && periodo !== 'custom') {
    marcas.push({ campo: 'periodo', texto: periodo === 'hoje' ? 'Hoje' : `Últimos ${periodo} dias` });
  } else {
    if (filtros.de) marcas.push({ campo: 'de', texto: `De ${dataCurta(filtros.de)}` });
    if (filtros.ate) marcas.push({ campo: 'ate', texto: `Até ${dataCurta(filtros.ate)}` });
  }

  show(alvo, marcas.length > 0);
  if (!marcas.length) {
    alvo.innerHTML = '';
    return;
  }

  alvo.innerHTML = juntar([
    html`<span class="log-marcas__rotulo">Filtrando por:</span>`,
    ...marcas.map((m) => html`
      <span class="log-marca">
        ${m.texto}
        <button type="button" data-action="auditoria-tirar" data-campo="${m.campo}"
                aria-label="Tirar o filtro ${m.texto}">${icone('x', 'ic ic--sm')}</button>
      </span>`),
    html`<button type="button" class="log-marcas__limpar" data-action="limpar-auditoria">limpar tudo</button>`,
  ]);
}

function dataCurta(iso: string): string {
  const [ano, mes, dia] = iso.split('-');
  return dia && mes ? `${dia}/${mes}/${ano}` : iso;
}

/* ===========================================================================
   A lista
   =========================================================================== */

const FORMATO_DIA = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
});

function maiuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** "Hoje · sábado, 14 de novembro" — ou a data inteira, nos dias antigos. */
function tituloDoDia(dia: string): string {
  const hoje = hojeISO();
  const ontem = new Date(`${hoje}T12:00:00Z`);
  ontem.setUTCDate(ontem.getUTCDate() - 1);

  const porExtenso = maiuscula(FORMATO_DIA.format(new Date(`${dia}T12:00:00Z`)));
  if (dia === hoje) return `Hoje · ${porExtenso}`;
  if (dia === ontem.toISOString().slice(0, 10)) return `Ontem · ${porExtenso}`;
  return `${porExtenso} de ${dia.slice(0, 4)}`;
}

function renderizar(): void {
  const lista = el('auditoria-lista');
  if (!lista) return;

  const registros = pagina?.data ?? [];

  const total = pagina?.total ?? 0;
  setText('conta-auditoria', String(total));
  setText('conta-auditoria-rotulo', total === 1 ? 'evento' : 'eventos');
  pintarPaginacao();
  pintarMarcas();
  pintarPeriodo();

  if (!registros.length) {
    lista.innerHTML = html`
      <div class="log-vazio">
        ${icone(ultimoErro ? 'circle-x' : 'shield-check', 'ic ic--xl')}
        <p>${raw(textoDoVazio())}</p>
      </div>`;
    return;
  }

  // Agrupa por dia, mantendo a ordem em que o back-end devolveu.
  const dias: { dia: string; eventos: RegistroAuditoria[] }[] = [];
  for (const r of registros) {
    const dia = (r.created_at ?? '').slice(0, 10);
    const ultimo = dias[dias.length - 1];
    if (ultimo && ultimo.dia === dia) ultimo.eventos.push(r);
    else dias.push({ dia, eventos: [r] });
  }

  lista.innerHTML = juntar(dias.map((d) => html`
    <section class="log-dia">
      <h3 class="log-dia__titulo">${tituloDoDia(d.dia)}</h3>
      ${raw(juntar(d.eventos.map(evento)))}
    </section>`));
}

function filtrando(): boolean {
  return Object.values(filtros).some(Boolean);
}

/** A lista vazia tem quatro motivos diferentes, e cada um pede outra frase. */
function textoDoVazio(): string {
  if (ultimoErro === 403) {
    return html`O seu acesso não alcança os logs. A trilha é da administração,
      e de quem recebeu <strong>ver auditoria</strong> em algum projeto.`;
  }

  if (ultimoErro) {
    return html`Não foi possível ler os logs agora (HTTP ${String(ultimoErro)}).
      Feche e abra de novo; se insistir, o motivo está no log da API.`;
  }

  if (filtrando()) {
    return html`Nenhum evento neste recorte. Limpe os filtros para ver a trilha inteira.`;
  }

  return html`Nada registrado ainda. Toda alteração feita pelas telas entra aqui.`;
}

/** Um evento: hora, ponto no fio do tempo, a frase e o que mudou. */
function evento(r: RegistroAuditoria): string {
  const hora = (dataHoraBR(r.created_at).split(' ')[1] ?? '').slice(0, 5);
  const acao = acaoDe(r.acao);
  const frase = fraseDe(r);
  // O nome guardado na hora vale mesmo sem o cadastro (pessoa removida,
  // tentativa de entrada com usuário que não existe, tarefa do sistema).
  const quem = r.funcionario?.nome ?? r.funcionario_nome ?? 'O sistema';
  const aberto = abertos.has(r.id);

  const meta = [
    ENTIDADE_ROTULO[r.entidade] ?? r.entidade,
    r.projeto ? r.projeto.codigo : '',
    r.ip ? `IP ${r.ip}` : '',
  ].filter(Boolean).join(' · ');

  return html`
    <article class="log-evento" data-tom="${acao.tom}" ${raw(aberto ? 'data-aberto' : '')}>
      <time class="log-evento__hora" datetime="${r.created_at}">${hora}</time>
      <span class="log-evento__fio" aria-hidden="true"><span class="log-evento__ponto"></span></span>

      <div class="log-evento__corpo">
        <p class="log-evento__frase">
          <strong>${quem}</strong> ${frase.antes}${raw(frase.alvo ? html` <strong>${frase.alvo}</strong>` : '')}${raw(frase.depois ? ` ${frase.depois}` : '')}
        </p>
        ${raw(resumoDoDiff(r))}
        <span class="log-evento__meta">${meta}</span>
      </div>

      <span class="pill log-evento__pill">${acao.rotulo}</span>

      <button type="button" class="log-evento__abrir" data-action="auditoria-abrir" data-id="${String(r.id)}"
              aria-expanded="${String(aberto)}" aria-label="${aberto ? 'Fechar' : 'Ver'} o evento inteiro">
        ${icone(aberto ? 'chevron-up' : 'chevron-right', 'ic ic--sm')}
      </button>

      ${raw(aberto ? detalhe(r, quem) : '')}
    </article>`;
}

/** Quantos campos mudados a linha mostra antes de resumir o resto. */
const CAMPOS_VISIVEIS = 2;

/** O "de → para" na própria linha: é o que o antigo "Detalhe" não mostrava. */
function resumoDoDiff(r: RegistroAuditoria): string {
  const alteracoes = r.alteracoes ?? {};
  const campos = Object.keys(alteracoes);
  if (!campos.length || r.acao === 'CRIOU') return '';

  const mostrados = campos.slice(0, CAMPOS_VISIVEIS);
  const resto = campos.length - mostrados.length;

  return html`
    <div class="log-mudancas">
      ${raw(juntar(mostrados.map((campo) => {
        const valores = alteracoes[campo];
        const temDe = valores && 'de' in valores;
        return html`
          <span class="log-mudanca">
            <span class="log-mudanca__campo">${CAMPO_ROTULO[campo] ?? campo}</span>
            ${raw(temDe ? html`<span class="log-mudanca__de">${textoDoValor(valores?.de)}</span>` : '')}
            ${icone('arrow-right', 'ic ic--sm')}
            <strong>${textoDoValor(valores?.para)}</strong>
          </span>`;
      })))}
      ${raw(resto > 0
        ? html`<span class="log-mudancas__resto">e mais ${String(resto)} ${resto === 1 ? 'campo' : 'campos'}</span>`
        : '')}
    </div>`;
}

/** O evento aberto: tudo o que a trilha guarda, sem sair da lista. */
function detalhe(r: RegistroAuditoria, quem: string): string {
  const alteracoes = r.alteracoes ?? {};
  const campos = Object.keys(alteracoes);

  const dados = [
    { rotulo: 'Quando', valor: dataHoraBR(r.created_at) },
    { rotulo: 'Quem', valor: r.funcionario?.email ? `${quem} · ${r.funcionario.email}` : quem },
    { rotulo: 'Registro', valor: `${ENTIDADE_ROTULO[r.entidade] ?? r.entidade}${r.entidade_id ? ` #${r.entidade_id}` : ''}` },
    { rotulo: 'Origem', valor: r.ip ? `IP ${r.ip}` : '—' },
  ];

  const tabela = campos.length
    ? html`
      <div class="log-tabela">
        <div class="log-tabela__cab">
          <span>Campo</span><span>${r.acao === 'CRIOU' ? 'Valor' : 'Antes'}</span><span>${r.acao === 'CRIOU' ? '' : 'Depois'}</span>
        </div>
        ${raw(juntar(campos.map((campo) => {
          const valores = alteracoes[campo];
          const temDe = Boolean(valores && 'de' in valores) && r.acao !== 'CRIOU';
          return html`
            <div class="log-tabela__linha">
              <span>${CAMPO_ROTULO[campo] ?? campo}</span>
              <span class="${raw(temDe ? 'log-tabela__de' : '')}">${textoDoValor(temDe ? valores?.de : valores?.para)}</span>
              <strong>${temDe ? textoDoValor(valores?.para) : ''}</strong>
            </div>`;
        })))}
      </div>`
    : html`<p class="log-detalhe__nada">Este evento não guarda campos alterados — o que importa está na frase acima.</p>`;

  return html`
    <div class="log-detalhe">
      <dl class="log-detalhe__dados">
        ${raw(juntar(dados.map((d) => html`
          <div>
            <dt>${d.rotulo}</dt>
            <dd>${d.valor}</dd>
          </div>`)))}
      </dl>
      ${raw(tabela)}
    </div>`;
}

/**
 * Códigos que o banco guarda em maiúsculas, como a tela os escreve. Sem isto
 * a trilha mostrava "status ATIVA → CANCELADA", que é o nome da coluna, não o
 * que a pessoa vê nas outras telas.
 */
const VALOR_ROTULO: Record<string, string> = {
  ATIVA: 'Ativa',
  PENDENTE: 'Pendente',
  CANCELADA: 'Cancelada',
  RESERVADA: 'Reservada',
  OCUPADA: 'Ocupada',
  MANUTENCAO: 'Em manutenção',
  INATIVA: 'Inativa',
  APROVADO: 'Aprovado',
  RECUSADO: 'Recusado',
  VASO: 'vasos',
  BANCADA: 'bancadas',
  LIDER: 'Líder',
  PESQUISADOR: 'Pesquisador',
  SU: 'Administração',
  FUNCIONARIO: 'Usuário comum',
};

/** Valor como a pessoa lê: vazio vira "—", booleano vira sim/não. */
function textoDoValor(valor: unknown): string {
  if (valor === null || valor === undefined || valor === '') return '—';
  if (valor === true) return 'sim';
  if (valor === false) return 'não';

  if (typeof valor === 'string') {
    if (VALOR_ROTULO[valor]) return VALOR_ROTULO[valor];
    // Data ou data e hora do banco: vai para o formato das outras telas.
    if (/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2})/.test(valor)) return dataHoraBR(valor);
    if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) return dataCurta(valor);
  }

  // Lista de vasos por tamanho e outros campos JSON: legível, não despejado.
  if (Array.isArray(valor)) {
    const itens = valor.map((item) => {
      if (item && typeof item === 'object' && 'tamanho_cm' in item) {
        const v = item as { tamanho_cm: unknown; quantidade: unknown };
        return `${String(v.quantidade)} de ${String(v.tamanho_cm)} cm`;
      }
      return typeof item === 'object' ? JSON.stringify(item) : String(item);
    });
    const texto = itens.join(' · ') || '—';
    return texto.length > 80 ? `${texto.slice(0, 77)}…` : texto;
  }

  const texto = typeof valor === 'object' ? JSON.stringify(valor) : String(valor);
  return texto.length > 80 ? `${texto.slice(0, 77)}…` : texto;
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
}

function pintarPeriodo(): void {
  for (const chip of document.querySelectorAll<HTMLButtonElement>('[data-action="auditoria-periodo"]')) {
    chip.setAttribute('aria-pressed', String(chip.dataset.periodo === periodo));
  }
}

/* ===========================================================================
   Ações
   =========================================================================== */

/** Um filtro mudou: volta para a primeira página, senão a página 7 some. */
export function definirFiltroAuditoria(campo: string, valor: string): void {
  if (!(campo in filtros)) return;

  filtros = { ...filtros, [campo]: valor };
  // Mexeu nas datas à mão: os chips de período saem de cena.
  if (campo === 'de' || campo === 'ate') periodo = 'custom';
  paginaAtual = 1;
  void carregar();
}

/** AAAA-MM-DD de hoje menos `dias`. */
function diasAtras(dias: number): string {
  const data = new Date(`${hojeISO()}T12:00:00Z`);
  data.setUTCDate(data.getUTCDate() - dias);
  return data.toISOString().slice(0, 10);
}

export function escolherPeriodoAuditoria(valor: string | undefined): void {
  const novo = (valor === 'hoje' || valor === '7' || valor === '30' ? valor : 'tudo') as Periodo;
  periodo = novo;

  const de = novo === 'hoje' ? hojeISO() : novo === 'tudo' ? '' : diasAtras(Number(novo) - 1);
  filtros = { ...filtros, de, ate: '' };

  const campoDe = el<HTMLInputElement>('auditoria-de');
  const campoAte = el<HTMLInputElement>('auditoria-ate');
  if (campoDe) campoDe.value = de;
  if (campoAte) campoAte.value = '';

  paginaAtual = 1;
  void carregar();
}

/** Atalho do topo: filtra por uma ação (ou pelo grupo de mudanças). */
export function escolherAtalhoAuditoria(chave: string | undefined): void {
  const atual = filtros.acao || '';
  const alvo = chave ?? '';

  // Clicar no que já está marcado desmarca; "MUDANCAS" não é uma ação só, e
  // a API filtra por uma — então ele limpa a ação e deixa o período valendo.
  filtros = { ...filtros, acao: alvo === atual || alvo === '' || alvo === 'MUDANCAS' ? '' : alvo };

  const select = el<HTMLSelectElement>('auditoria-acao');
  if (select) select.value = filtros.acao;

  if (alvo === 'MUDANCAS') {
    aviso('A API filtra por uma ação de cada vez: escolha Criou, Alterou ou Excluiu em "Mais filtros".', 'info');
    abrirMaisFiltros(true);
  }

  paginaAtual = 1;
  void carregar();
}

export function alternarMaisFiltros(): void {
  abrirMaisFiltros(el('auditoria-avancado')?.hidden !== false);
}

function abrirMaisFiltros(abrir: boolean): void {
  show(el('auditoria-avancado'), abrir);
  el('auditoria-mais')?.setAttribute('aria-expanded', String(abrir));
}

/** X de uma marca: tira só aquele filtro. */
export function tirarFiltroAuditoria(campo: string | undefined): void {
  if (campo === 'periodo') {
    escolherPeriodoAuditoria('tudo');
    return;
  }
  if (!campo || !(campo in filtros)) return;

  if (campo === 'busca') {
    const busca = el<HTMLInputElement>('auditoria-busca');
    if (busca) busca.value = '';
  }
  const select = el<HTMLSelectElement>(`auditoria-${campo === 'funcionario_id' ? 'pessoa' : campo === 'projeto_id' ? 'projeto' : campo}`);
  if (select) select.value = '';
  const data = el<HTMLInputElement>(`auditoria-${campo}`);
  if (data && (campo === 'de' || campo === 'ate')) data.value = '';

  definirFiltroAuditoria(campo, '');
}

/** Abre ou fecha o registro inteiro de um evento. */
export function abrirEventoAuditoria(id: string): void {
  const numero = Number(id);
  if (abertos.has(numero)) abertos.delete(numero);
  else abertos.add(numero);
  renderizar();

  // Depois de redesenhar, o foco volta para o botão do mesmo evento.
  qs<HTMLElement>(`[data-action="auditoria-abrir"][data-id="${id}"]`)?.focus({ preventScroll: true });
}

export function limparFiltrosAuditoria(): void {
  filtros = { ...VAZIO };
  periodo = 'tudo';
  paginaAtual = 1;
  abertos.clear();

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
  abertos.clear();
  void carregar();
  el('auditoria-lista')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
