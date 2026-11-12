/**
 * Reservar um espaço e consultar uma reserva.
 *
 * A reserva é um período (início e fim) + uma QUANTIDADE de vasos ou bancadas.
 * O que não for reservado continua disponível para outro pesquisador no mesmo
 * período, e é o back-end que decide se cabe — este arquivo só pergunta antes
 * (para avisar na hora) e manda a reserva depois.
 *
 * Com a API configurada, nada mais morre no localStorage: criar e cancelar
 * gravam no banco e a tela recarrega do que o banco respondeu.
 */
import {
  ESTUFAS,
  ID_REAL_ESPACO,
  ID_REAL_RESERVA,
  aceitaReserva,
  carregarEstado,
  invalidarEstado,
  reservas,
} from '../data/estufas';
import { dadosMudaram } from '../lib/bus';
import { el, setText, show } from '../lib/dom';
import { html, icone } from '../lib/html';
import { capacidade, dataBR, hojeISO, ocupacaoResumo, plural, statusPill } from '../lib/format';
import { abrirModal, confirmar, fecharModal, fecharTodosModais, trocarModal } from '../lib/modal';
import { aviso } from '../lib/toast';
import {
  carregarContexto,
  contextoAtual,
  motivoParaNaoReservar,
  projetosParaReservar,
} from '../data/contexto';
import {
  cancelarReserva as apiCancelar,
  atualizarReserva,
  criarReserva,
  excluirReserva,
  getDisponibilidade,
} from '../services/api';
import { fecharPainel } from './mapa';

/** Espaço que o modal de reserva está preenchendo. */
let espacoDaReserva: string | null = null;
/** Reserva aberta no modal de consulta. */
let reservaAberta: string | null = null;
/** Evita que duas confirmações saiam juntas no clique repetido. */
let enviando = false;

/* ---------------------------------------------------------------------------
   Projetos e finalidades do formulário

   O campo de projeto era texto livre e o back-end espera o id — digitar o
   nome do projeto virava "campo obrigatório" sem explicação. Agora é uma
   escolha entre os projetos em que a pessoa PODE reservar, que é onde a
   permissão mora.
   ------------------------------------------------------------------------ */

interface ProjetoDoCampo {
  id: number;
  codigo: string;
  titulo: string;
}

let projetosDoCampo: ProjetoDoCampo[] | null = null;
let carregandoProjetos = false;

async function garantirProjetos(): Promise<ProjetoDoCampo[]> {
  if (projetosDoCampo) return projetosDoCampo;

  // A regra de quais projetos servem para reservar (aprovados, não encerrados
  // e com permissão) mora em data/contexto: a ficha do espaço usa a mesma para
  // decidir se o botão abre, e as duas precisam concordar.
  if (!contextoAtual()) await carregarContexto();

  projetosDoCampo = projetosParaReservar().map((p) => ({
    id: p.id,
    codigo: p.codigo,
    titulo: p.titulo,
  }));

  return projetosDoCampo;
}

/** Enche o datalist do campo de projeto: o código sugere, o título explica. */
function pintarProjetos(lista: ProjetoDoCampo[]): void {
  const sugestoes = el('lista-projetos');
  const ajuda = el('reservar-projeto-ajuda');

  if (sugestoes) {
    sugestoes.innerHTML = '';
    for (const p of lista) {
      const opcao = document.createElement('option');
      opcao.value = p.codigo;
      opcao.label = p.titulo;
      opcao.textContent = p.titulo;
      sugestoes.appendChild(opcao);
    }
  }

  if (ajuda) {
    ajuda.textContent = lista.length
      ? 'Aparecem só os projetos em que você pode reservar.'
      : motivoParaNaoReservar() ?? 'Nenhum projeto disponível para reserva.';
  }
}

/**
 * Descobre qual projeto a pessoa escreveu. Aceita o código, o título ou o id,
 * sem diferenciar maiúscula, acento ou espaço sobrando — o campo é livre, e
 * quem decide é a comparação, não a digitação exata.
 */
function acharProjeto(texto: string): ProjetoDoCampo | null {
  const alvo = normalizar(texto);
  if (!alvo) return null;

  const lista = projetosDoCampo ?? [];

  return lista.find((p) => normalizar(p.codigo) === alvo)
    ?? lista.find((p) => normalizar(p.titulo) === alvo)
    ?? lista.find((p) => String(p.id) === alvo)
    ?? lista.find((p) => normalizar(`${p.codigo} — ${p.titulo}`) === alvo)
    ?? null;
}

function normalizar(texto: string): string {
  return texto.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Sugestões de finalidade: o que já foi usado nas reservas. */
function pintarFinalidades(): void {
  const lista = el('lista-finalidades');
  if (!lista) return;

  const usadas = reservas.map((r) => (r.finalidade ?? '').trim()).filter(Boolean);
  const todas = [...new Set(usadas)]
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));

  lista.innerHTML = '';
  for (const texto of todas) {
    const opcao = document.createElement('option');
    opcao.value = texto;
    lista.appendChild(opcao);
  }
}

/** Carrega os projetos em segundo plano e repinta quando chegarem. */
function prepararCamposDaReserva(): void {
  pintarFinalidades();

  if (projetosDoCampo) {
    pintarProjetos(projetosDoCampo);
    return;
  }

  if (carregandoProjetos) return;
  carregandoProjetos = true;

  void garantirProjetos()
    .then(pintarProjetos)
    .catch(() => pintarProjetos([]))
    .finally(() => { carregandoProjetos = false; });
}

/* ---------------------------------------------------------------------------
   Rascunho da reserva

   Fechar o modal sem querer — um clique fora, um Esc — apagava período,
   quantidade, projeto e finalidade. Agora o que está preenchido fica guardado
   por espaço e volta ao reabrir. Só some quando a reserva é enviada ou quando
   a pessoa diz, no botão, que está descartando.

   Fica no localStorage: é rascunho do navegador de quem está preenchendo, não
   dado do sistema — não tem por que ocupar o banco.
   --------------------------------------------------------------------------- */

const CHAVE_RASCUNHO = 'cvgweb:rascunho-reserva:v1';

/** Rascunho velho não serve: o período que ele guarda já passou. */
const VALIDADE_RASCUNHO_MS = 24 * 60 * 60 * 1000;

const CAMPOS_RASCUNHO = [
  'reservar-data-inicio',
  'reservar-data-fim',
  'reservar-quantidade',
  'reservar-projeto',
  'reservar-finalidade',
  'reservar-obs',
] as const;

interface Rascunho {
  em: number;
  campos: Record<string, string>;
}

function lerRascunhos(): Record<string, Rascunho> {
  try {
    const bruto = localStorage.getItem(CHAVE_RASCUNHO);
    return bruto ? (JSON.parse(bruto) as Record<string, Rascunho>) : {};
  } catch (erro) {
    console.warn('[CVGWeb] rascunho de reserva inválido, ignorando:', erro);
    return {};
  }
}

function gravarRascunhos(mapa: Record<string, Rascunho>): void {
  try {
    localStorage.setItem(CHAVE_RASCUNHO, JSON.stringify(mapa));
  } catch (erro) {
    // Sem espaço ou em aba anônima: perder o rascunho não pode quebrar a tela.
    console.warn('[CVGWeb] não foi possível guardar o rascunho:', erro);
  }
}

/** Guarda o que está na tela. Chamado a cada digitação no formulário. */
export function guardarRascunhoDaReserva(): void {
  if (!espacoDaReserva) return;

  const campos: Record<string, string> = {};
  for (const id of CAMPOS_RASCUNHO) campos[id] = valor(id);

  // Formulário vazio não vira rascunho: senão abrir e fechar já deixava lixo.
  const temAlgo = CAMPOS_RASCUNHO.some((id) => {
    const v = campos[id] ?? '';
    return id === 'reservar-quantidade' ? v !== '' && v !== '1' : v !== '';
  });

  const mapa = lerRascunhos();
  if (temAlgo) mapa[espacoDaReserva] = { em: Date.now(), campos };
  else delete mapa[espacoDaReserva];

  gravarRascunhos(mapa);
}

/** Põe de volta o que estava preenchido. Devolve true se restaurou algo. */
function restaurarRascunho(estufaId: string): boolean {
  const mapa = lerRascunhos();
  const rascunho = mapa[estufaId];
  if (!rascunho) return false;

  if (Date.now() - rascunho.em > VALIDADE_RASCUNHO_MS) {
    delete mapa[estufaId];
    gravarRascunhos(mapa);
    return false;
  }

  const hoje = hojeISO();
  let restaurou = false;

  for (const id of CAMPOS_RASCUNHO) {
    const guardado = rascunho.campos[id] ?? '';
    if (!guardado) continue;

    // Data que já passou não volta: o campo tem min = hoje e ficaria inválida.
    if ((id === 'reservar-data-inicio' || id === 'reservar-data-fim') && guardado < hoje) continue;

    const campo = el<HTMLInputElement>(id);
    if (!campo) continue;
    campo.value = guardado;
    restaurou = true;
  }

  return restaurou;
}

/** Joga fora o rascunho de um espaço. */
function descartarRascunhoDaReserva(estufaId = espacoDaReserva): void {
  if (!estufaId) return;
  const mapa = lerRascunhos();
  if (!(estufaId in mapa)) return;
  delete mapa[estufaId];
  gravarRascunhos(mapa);
}

/** Botão "Cancelar" do modal: aí sim a pessoa está desistindo de propósito. */
export function cancelarPreenchimentoDaReserva(): void {
  descartarRascunhoDaReserva();
  espacoDaReserva = null;
  fecharTodosModais();
}

function valor(id: string): string {
  return (el<HTMLInputElement>(id)?.value ?? '').trim();
}

function numero(id: string): number {
  const bruto = Number.parseInt(valor(id), 10);
  return Number.isNaN(bruto) ? 0 : bruto;
}

/* ===========================================================================
   Reservar
   =========================================================================== */

export function abrirModalReservar(estufaId: string): void {
  const estufa = ESTUFAS[estufaId];
  if (!estufa) return;

  if (!aceitaReserva(estufa)) {
    aviso(
      estufa.situacao === 'ATIVA'
        ? `${estufa.nome} está com a capacidade cheia hoje.`
        : `${estufa.nome} não está disponível (${estufa.situacao.toLowerCase()}).`,
      'error',
    );
    return;
  }

  espacoDaReserva = estufaId;

  setText('reservar-titulo', `Reservar ${estufa.nome}`);
  setText('reservar-descricao', `${estufa.codigo} · ${estufa.desc || estufa.tipo}`);
  setText('reservar-area', estufa.area);
  setText('reservar-bancadas', plural(estufa.cap, 'bancada', 'bancadas'));
  setText(
    'reservar-capacidade',
    ocupacaoResumo(estufa.disponivel, estufa.capacidadeTotal, estufa.unidade),
  );

  const status = el('reservar-status');
  if (status) status.innerHTML = html`${statusPill(estufa.status)}`;

  const marca = el('reservar-marca');
  if (marca) marca.innerHTML = html`${icone(estufa.icon)}`;

  el<HTMLFormElement>('form-reservar')?.reset();
  prepararCamposDaReserva();

  // A quantidade nasce em 1 e não passa do que está livre hoje.
  const quantidade = el<HTMLInputElement>('reservar-quantidade');
  if (quantidade) {
    quantidade.min = '1';
    quantidade.max = String(Math.max(1, estufa.disponivel));
    quantidade.value = '1';
    quantidade.removeAttribute('aria-invalid');
  }
  setText('reservar-unidade', estufa.unidade === 'VASO' ? 'vasos' : 'bancadas');

  // O período não pode começar no passado.
  const hoje = hojeISO();
  const inicio = el<HTMLInputElement>('reservar-data-inicio');
  const fim = el<HTMLInputElement>('reservar-data-fim');
  for (const campo of [inicio, fim]) {
    if (!campo) continue;
    campo.min = hoje;
    campo.removeAttribute('aria-invalid');
  }

  mostrarAviso(null);

  // O que a pessoa já tinha preenchido antes de fechar sem querer.
  if (restaurarRascunho(estufaId)) {
    aviso('Recuperei o que você já tinha preenchido nesta reserva.', 'info');
    ajustarFimDoPeriodo();
  }

  fecharPainel();
  abrirModal('modal-reservar');
}

/** O fim do período acompanha o início, para não ficar para trás dele. */
export function ajustarFimDoPeriodo(): void {
  const inicio = el<HTMLInputElement>('reservar-data-inicio');
  const fim = el<HTMLInputElement>('reservar-data-fim');
  if (!inicio || !fim) return;

  if (inicio.value) fim.min = inicio.value;
  if (fim.value && inicio.value && fim.value < inicio.value) fim.value = inicio.value;

  void consultarDisponibilidade();
}

function mostrarAviso(mensagem: string | null, tom: 'ok' | 'erro' = 'ok'): void {
  const caixa = el('reservar-aviso');
  show(caixa, Boolean(mensagem));
  if (caixa) caixa.dataset.tom = tom;
  if (mensagem) setText('reservar-aviso-texto', mensagem);
}

/**
 * Pergunta ao back-end quanto sobra no período escolhido e mostra a resposta
 * antes de a pessoa enviar — é a mesma frase que viria no erro, só que a
 * tempo de corrigir ("só 10 de 20 vasos disponíveis; os outros estão com...").
 */
export async function consultarDisponibilidade(): Promise<void> {
  if (!espacoDaReserva) return;

  const estufa = ESTUFAS[espacoDaReserva];
  const casaId = ID_REAL_ESPACO[espacoDaReserva];
  const inicio = valor('reservar-data-inicio');
  const fim = valor('reservar-data-fim');

  if (!estufa || !casaId || !inicio || !fim || fim < inicio) return;

  const pedido = numero('reservar-quantidade');

  try {
    const resposta = await getDisponibilidade(casaId, {
      de: inicio,
      ate: fim,
      quantidade: pedido || undefined,
    });

    const campo = el<HTMLInputElement>('reservar-quantidade');
    if (campo) campo.max = String(Math.max(1, resposta.disponivel));

    mostrarAviso(resposta.mensagem, resposta.cabe === false ? 'erro' : 'ok');
  } catch (erro) {
    // Falha de rede aqui não impede reservar: o back-end confere de novo.
    console.warn('[CVGWeb] não foi possível consultar a disponibilidade:', erro);
  }
}

export async function confirmarReserva(): Promise<void> {
  if (!espacoDaReserva || enviando) return;

  const estufa = ESTUFAS[espacoDaReserva];
  if (!estufa) return;

  const inicio = valor('reservar-data-inicio');
  const fim = valor('reservar-data-fim');
  const projeto = valor('reservar-projeto');
  const finalidade = valor('reservar-finalidade');
  const obs = valor('reservar-obs');
  const quantidade = numero('reservar-quantidade');

  if (!inicio || !fim || !finalidade) {
    aviso('Preencha o período e a finalidade.', 'error');
    return;
  }

  const campoProjeto = el<HTMLInputElement>('reservar-projeto');
  const projetoEscolhido = acharProjeto(projeto);

  if (!projetoEscolhido) {
    campoProjeto?.setAttribute('aria-invalid', 'true');
    campoProjeto?.focus();
    aviso(
      projeto
        ? `Não achei o projeto "${projeto}". Escolha um da lista que aparece ao digitar.`
        : 'Informe o projeto da reserva.',
      'error',
    );
    return;
  }
  campoProjeto?.removeAttribute('aria-invalid');

  const campoQuantidade = el<HTMLInputElement>('reservar-quantidade');
  if (quantidade < 1) {
    campoQuantidade?.setAttribute('aria-invalid', 'true');
    campoQuantidade?.focus();
    aviso(`Informe quantos ${estufa.unidade === 'VASO' ? 'vasos' : 'bancadas'} você precisa.`, 'error');
    return;
  }
  campoQuantidade?.removeAttribute('aria-invalid');

  const campoFim = el<HTMLInputElement>('reservar-data-fim');
  if (fim < inicio) {
    campoFim?.setAttribute('aria-invalid', 'true');
    campoFim?.focus();
    aviso('O fim do período não pode ser antes do início.', 'error');
    return;
  }
  campoFim?.removeAttribute('aria-invalid');

  const botao = el<HTMLButtonElement>('reservar-enviar');
  enviando = true;
  if (botao) botao.disabled = true;

  try {
    const mensagem = await reservarNaApi(espacoDaReserva, {
      inicio, fim, projeto: String(projetoEscolhido.id), finalidade, obs, quantidade,
    });
    aviso(mensagem, 'success');
  } catch (erro) {
    // A mensagem do back-end é a boa: diz quanto sobrou e com quem está.
    const mensagem = erro instanceof Error ? erro.message : 'Não foi possível reservar.';
    mostrarAviso(mensagem, 'erro');
    aviso(mensagem, 'error');
    return;
  } finally {
    enviando = false;
    if (botao) botao.disabled = false;
  }

  // Reserva enviada: o rascunho cumpriu o papel dele. Soltar `espacoDaReserva`
  // ANTES de fechar e de propósito: fechar o modal grava o rascunho do espaço
  // aberto, e sem isto a reserva recém-enviada voltaria como rascunho.
  descartarRascunhoDaReserva();
  espacoDaReserva = null;

  dadosMudaram();
  fecharModal(el('modal-reservar'));
}

interface DadosReserva {
  inicio: string;
  fim: string;
  projeto: string;
  finalidade: string;
  obs: string;
  quantidade: number;
}

/** Grava a reserva no banco e recarrega o estado do que a API respondeu. */
async function reservarNaApi(estufaId: string, dados: DadosReserva): Promise<string> {
  const casaId = ID_REAL_ESPACO[estufaId];
  if (!casaId) throw new Error('Espaço sem vínculo com o cadastro; recarregue a página.');

  const resposta = await criarReserva({
    casa_vegetacao_id: casaId,
    quantidade: dados.quantidade,
    data_inicio: dados.inicio,
    data_fim: dados.fim,
    finalidade: dados.finalidade,
    obs: dados.obs || undefined,
    // O select guarda o id do projeto; a reserva precisa dele para a permissão.
    projeto_id: Number(dados.projeto),
  });

  invalidarEstado();
  await carregarEstado('manter');

  return resposta?.message ?? 'Reserva registrada.';
}

/* ===========================================================================
   Consultar
   =========================================================================== */

export function verReserva(id: string): void {
  const reserva = reservas.find((r) => r.id === id);
  if (!reserva) return;

  const estufa = ESTUFAS[reserva.estufaId];
  reservaAberta = id;

  setText('ver-reserva-titulo', estufa ? estufa.nome : reserva.estufaId);
  setText('ver-reserva-descricao', estufa ? `${estufa.codigo} · ${estufa.tipo}` : 'Espaço não encontrado');
  setText('ver-reserva-codigo', reserva.id);
  setText('ver-reserva-inicio', dataBR(reserva.data));
  setText('ver-reserva-fim', dataBR(reserva.dataFim));
  setText(
    'ver-reserva-quantidade',
    capacidade(reserva.quantidade, estufa?.unidade ?? 'VASO'),
  );
  setText('ver-reserva-projeto', reserva.projeto || '—');
  setText('ver-reserva-finalidade', reserva.finalidade || '—');
  setText('ver-reserva-pesquisador', reserva.pesquisador || '—');

  const status = el('ver-reserva-status');
  if (status) status.innerHTML = html`${statusPill(reserva.status)}`;

  // Reserva já cancelada não oferece o botão de cancelar.
  show(el('ver-reserva-cancelar'), reserva.status !== 'cancelada');

  fecharPainel();
  abrirModal('modal-ver-reserva');
}

export async function cancelarReservaAberta(): Promise<void> {
  const reserva = reservas.find((r) => r.id === reservaAberta);
  if (!reserva || reserva.status === 'cancelada') {
    fecharTodosModais();
    return;
  }

  try {
    await cancelarNoDestino(reserva.id);
  } catch (erro) {
    aviso(erro instanceof Error ? erro.message : 'Não foi possível cancelar.', 'error');
    return;
  }

  dadosMudaram();
  fecharTodosModais();
  reservaAberta = null;
  aviso(`Reserva ${reserva.id} cancelada; a capacidade voltou a ficar disponível.`, 'info');
}

/** Cancela a reserva no banco. Usado também pela administração. */
export async function cancelarNoDestino(codigo: string, motivo?: string): Promise<void> {
  const reserva = reservas.find((r) => r.id === codigo);
  if (!reserva) return;

  const id = ID_REAL_RESERVA[codigo];
  if (!id) throw new Error('Reserva sem vínculo com o cadastro; recarregue a página.');

  await apiCancelar(id, motivo);
  invalidarEstado();
  await carregarEstado('manter');
}


/* ===========================================================================
   Editar e excluir reserva

   `PUT` e `DELETE /api/reservas/{id}` sempre existiram sem tela: esticar uma
   reserva em dois dias obrigava a cancelar e pedir de novo, e no intervalo
   entre as duas coisas a capacidade ficava livre para outro pesquisador tomar.

   O projeto não é editável aqui de propósito: é ele que decide de quem são as
   permissões sobre a reserva, e trocá-lo no meio do caminho mudaria quem pode
   aprovar e cancelar o que já está em andamento. Para isso, cancela e pede de
   novo no projeto certo.
   ======================================================================== */

/** Reserva aberta no formulário de edição. */
let reservaEmEdicao: string | null = null;

/** Botão "Editar" da ficha da reserva, aberta pelo mapa. */
export function editarReservaAberta(): void {
  if (reservaAberta) abrirEditarReserva(reservaAberta);
}

export function abrirEditarReserva(codigo: string): void {
  const reserva = reservas.find((r) => r.id === codigo);
  if (!reserva) return;

  const estufa = ESTUFAS[reserva.estufaId];

  if (reserva.status === 'cancelada') {
    aviso('Reserva cancelada não é editada: faça um novo pedido.', 'error');
    return;
  }

  reservaEmEdicao = codigo;

  setText('editar-reserva-titulo', `Reserva ${reserva.id}`);
  setText(
    'editar-reserva-desc',
    estufa
      ? `${estufa.codigo} — ${estufa.nome}${reserva.projeto ? ` · ${reserva.projeto}` : ''}`
      : reserva.estufaId,
  );

  const status = el('editar-reserva-status');
  if (status) status.innerHTML = html`${statusPill(reserva.status)}`;

  setText('editar-reserva-responsavel', reserva.pesquisador || 'não informado');
  setText(
    'editar-reserva-capacidade',
    estufa ? capacidade(estufa.capacidadeTotal, estufa.unidade) : '—',
  );
  setText('editar-reserva-unidade', estufa?.unidade === 'BANCADA' ? 'bancadas' : 'vasos');

  preencher('editar-reserva-inicio', reserva.data);
  preencher('editar-reserva-fim', reserva.dataFim);
  preencher('editar-reserva-quantidade', String(reserva.quantidade));
  preencher('editar-reserva-finalidade', reserva.finalidade ?? '');
  preencher('editar-reserva-obs', reserva.obs ?? '');

  // O datalist de finalidades é o mesmo do formulário de nova reserva; sem
  // isto ele chegaria vazio para quem abre a edição sem ter reservado antes.
  pintarFinalidades();

  mostrarDisponibilidadeDaEdicao(null);
  show(el('editar-reserva-erro'), false);

  // Da seção de reservas abre por cima da tabela; da ficha do mapa, troca a
  // ficha pelo formulário, para não empilhar dois modais.
  if (el('modal-ver-reserva')?.hidden === false) trocarModal('modal-ver-reserva', 'modal-reserva-editar');
  else abrirModal('modal-reserva-editar');

  void consultarDisponibilidadeDaEdicao();
}

function preencher(id: string, valorNovo: string): void {
  const campo = el<HTMLInputElement | HTMLTextAreaElement>(id);
  if (campo) campo.value = valorNovo;
}

function mostrarDisponibilidadeDaEdicao(mensagem: string | null, tom: 'ok' | 'erro' = 'ok'): void {
  const caixa = el('editar-reserva-disponibilidade');
  show(caixa, Boolean(mensagem));
  if (caixa) caixa.dataset.tom = tom;
  if (mensagem) setText('editar-reserva-disponibilidade-texto', mensagem);
}

/**
 * Quanto sobra no período novo, sem contar esta reserva.
 *
 * O `ignorar_reserva` é o que faz a conta fechar: sem ele, a própria reserva
 * entraria duas vezes na soma e crescer de 6 para 10 numa estufa de 10 seria
 * recusado como se fossem 16.
 */
export async function consultarDisponibilidadeDaEdicao(): Promise<void> {
  if (!reservaEmEdicao) return;

  const reserva = reservas.find((r) => r.id === reservaEmEdicao);
  if (!reserva) return;

  const casaId = ID_REAL_ESPACO[reserva.estufaId];
  const real = ID_REAL_RESERVA[reservaEmEdicao];
  const inicio = valor('editar-reserva-inicio');
  const fim = valor('editar-reserva-fim');

  if (!casaId || !inicio || !fim || fim < inicio) return;

  try {
    const resposta = await getDisponibilidade(casaId, {
      de: inicio,
      ate: fim,
      quantidade: numero('editar-reserva-quantidade') || undefined,
      ignorarReserva: real,
    });

    const campo = el<HTMLInputElement>('editar-reserva-quantidade');
    if (campo) campo.max = String(Math.max(1, resposta.disponivel));

    mostrarDisponibilidadeDaEdicao(resposta.mensagem, resposta.cabe === false ? 'erro' : 'ok');
  } catch (erro) {
    // Falha aqui não impede salvar: o back-end confere de novo.
    console.warn('[CVGWeb] não foi possível consultar a disponibilidade:', erro);
  }
}

/** Fim antes do início não existe: o campo de fim acompanha o de início. */
export function ajustarFimDaEdicao(): void {
  const inicio = el<HTMLInputElement>('editar-reserva-inicio');
  const fim = el<HTMLInputElement>('editar-reserva-fim');
  if (!inicio || !fim) return;

  fim.min = inicio.value;
  if (fim.value && fim.value < inicio.value) fim.value = inicio.value;
}

export async function confirmarEdicaoReserva(): Promise<void> {
  if (!reservaEmEdicao || enviando) return;

  const codigo = reservaEmEdicao;
  const real = ID_REAL_RESERVA[codigo];

  if (!real) {
    mostrarErroDaEdicao('Reserva sem vínculo com o cadastro; recarregue a página.');
    return;
  }

  const inicio = valor('editar-reserva-inicio');
  const fim = valor('editar-reserva-fim');
  const finalidade = valor('editar-reserva-finalidade');
  const quantidade = numero('editar-reserva-quantidade');

  if (!inicio || !fim || !finalidade) {
    mostrarErroDaEdicao('Preencha o período e a finalidade.');
    return;
  }

  if (fim < inicio) {
    mostrarErroDaEdicao('O fim do período não pode ser antes do início.');
    return;
  }

  if (quantidade < 1) {
    mostrarErroDaEdicao('Informe a quantidade reservada.');
    return;
  }

  const botao = el<HTMLButtonElement>('editar-reserva-enviar');
  enviando = true;
  if (botao) botao.disabled = true;

  let mensagem = 'Reserva alterada.';

  try {
    const resposta = await atualizarReserva(real, {
      data_inicio: inicio,
      data_fim: fim,
      quantidade,
      finalidade,
      obs: valor('editar-reserva-obs') || null,
    });

    // O back-end diz se a alteração devolveu a reserva para a fila.
    mensagem = resposta?.message ?? mensagem;

    invalidarEstado();
    await carregarEstado('manter');
  } catch (erro) {
    mostrarErroDaEdicao(erro instanceof Error ? erro.message : 'Não foi possível salvar a reserva.');
    return;
  } finally {
    enviando = false;
    if (botao) botao.disabled = false;
  }

  reservaEmEdicao = null;
  show(el('editar-reserva-erro'), false);
  fecharModal(el('modal-reserva-editar'));
  dadosMudaram();

  aviso(mensagem, 'success');
}

function mostrarErroDaEdicao(mensagem: string): void {
  setText('editar-reserva-erro-texto', mensagem);
  show(el('editar-reserva-erro'), true);
}

/**
 * Exclui a reserva de vez.
 *
 * Diferente de cancelar: cancelar guarda o registro (e o motivo) na agenda e na
 * auditoria; excluir tira a linha do banco. A auditoria mantém o rastro da
 * exclusão, mas a reserva em si não voltam — por isso a confirmação diz isso.
 */
export async function excluirReservaAberta(): Promise<void> {
  if (!reservaEmEdicao) return;

  const codigo = reservaEmEdicao;
  const reserva = reservas.find((r) => r.id === codigo);
  const real = ID_REAL_RESERVA[codigo];
  if (!reserva || !real) return;

  const estufa = ESTUFAS[reserva.estufaId];

  const ok = await confirmar({
    titulo: `Excluir a reserva ${reserva.id}?`,
    mensagem: html`
      A linha sai do banco e a capacidade de
      ${estufa ? `${estufa.codigo} — ${estufa.nome}` : reserva.estufaId}
      volta a ficar disponível. Para guardar o registro e o motivo na agenda,
      <strong>cancele</strong> em vez de excluir.`,
    icone: 'trash-2',
    confirmar: 'Excluir',
    cancelar: 'Voltar',
    perigo: true,
  });

  if (!ok) return;

  try {
    await excluirReserva(real);
    invalidarEstado();
    await carregarEstado('manter');
  } catch (erro) {
    mostrarErroDaEdicao(erro instanceof Error ? erro.message : 'Não foi possível excluir a reserva.');
    return;
  }

  reservaEmEdicao = null;
  fecharTodosModais();
  dadosMudaram();

  aviso(`Reserva ${reserva.id} excluída.`, 'info');
}
