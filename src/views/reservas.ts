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
  reservas,
  unidadesComVaga,
} from '../data/estufas';
import type { Estufa, UnidadeCapacidade } from '../types';
import { dadosMudaram } from '../lib/bus';
import { el, qs, setText, show } from '../lib/dom';
import { html, icone, juntar, raw } from '../lib/html';
import { capacidade, dataBR, hojeISO, ocupacaoResumo, plural, statusPill, temperaturaTexto } from '../lib/format';
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
  criarReservasEmLote,
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

/**
 * Esquece a lista de projetos do formulário: a próxima abertura monta de novo
 * a partir do contexto. A casca chama quando as permissões mudam — projeto
 * criado, aprovado ou com a equipe mexida.
 */
export function esquecerProjetosDaReserva(): void {
  projetosDoCampo = null;
}

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

/* ---------------------------------------------------------------------------
   Campo de projeto com busca (issue #33)

   Ao focar, a lista mostra todos os projetos em que a pessoa pode reservar; ao
   digitar, fica só com os que contêm o texto, sem diferenciar maiúscula nem
   acento. Setas andam, Enter escolhe, Esc fecha. O id do projeto escolhido vai
   para o campo oculto #reservar-projeto — é ele que a reserva manda.
   ------------------------------------------------------------------------ */

interface ProjetoDaLista extends ProjetoDoCampo {
  lider?: string;
}

let projetosDaLista: ProjetoDaLista[] = [];
let visiveis: ProjetoDaLista[] = [];
let destacado = -1;
let campoLigado = false;

function campoBusca(): HTMLInputElement | null {
  return el<HTMLInputElement>('reservar-projeto-busca');
}

/** Escolhe (ou limpa, com null) o projeto da reserva. */
function escolherProjeto(projeto: ProjetoDaLista | null): void {
  const oculto = el<HTMLInputElement>('reservar-projeto');
  if (oculto) oculto.value = projeto ? String(projeto.id) : '';

  const busca = campoBusca();
  if (busca) {
    busca.value = projeto?.titulo ?? '';
    if (projeto) busca.removeAttribute('aria-invalid');
  }
  if (projeto) show(el('reservar-projeto-erro'), false);
}

/** Texto com o trecho buscado destacado; tudo escapado pelo html``. */
function destacar(texto: string, busca: string): string {
  const alvo = normalizar(busca);
  const posicao = alvo ? normalizar(texto).indexOf(alvo) : -1;
  if (posicao < 0) return html`${texto}`;

  // normalizar() decompõe "é" em "e" + acento e descarta o acento: cada letra
  // continua ocupando uma posição, então o índice vale no texto original.
  const fimDoTrecho = posicao + alvo.length;
  return html`${texto.slice(0, posicao)}<mark>${texto.slice(posicao, fimDoTrecho)}</mark>${texto.slice(fimDoTrecho)}`;
}

function pintarLista(): void {
  const lista = el('reservar-projeto-lista');
  const busca = campoBusca();
  if (!lista || !busca) return;

  const texto = busca.value;
  const alvo = normalizar(texto);
  visiveis = projetosDaLista.filter((p) => normalizar(p.titulo).includes(alvo));
  if (destacado >= visiveis.length) destacado = visiveis.length - 1;

  if (!projetosDaLista.length) {
    lista.innerHTML = html`<li class="combo__vazio" role="presentation">${motivoParaNaoReservar() ?? 'Nenhum projeto disponível para reserva.'}</li>`;
  } else if (!visiveis.length) {
    lista.innerHTML = html`<li class="combo__vazio" role="presentation">Nenhum projeto com “${texto.trim()}”. Confira o nome ou peça para entrar na equipe.</li>`;
  } else {
    lista.innerHTML = juntar(visiveis.map((p, i) => html`
      <li class="combo__opcao" role="option" id="reservar-projeto-op-${i}" data-indice="${i}"
          aria-selected="${String(i === destacado)}">
        <span>${raw(destacar(p.titulo, texto))}</span>
        ${raw(p.lider ? html`<span class="combo__sub">${p.lider}</span>` : '')}
      </li>`));
  }

  if (destacado >= 0) busca.setAttribute('aria-activedescendant', `reservar-projeto-op-${destacado}`);
  else busca.removeAttribute('aria-activedescendant');

  lista.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  abrirLista(true);
}

function abrirLista(aberta: boolean): void {
  show(el('reservar-projeto-lista'), aberta);
  campoBusca()?.setAttribute('aria-expanded', String(aberta));
  if (!aberta) destacado = -1;
}

/** Liga os eventos do campo uma vez só: o modal é reaproveitado. */
function ligarCampoDeProjeto(): void {
  const busca = campoBusca();
  const lista = el('reservar-projeto-lista');
  if (campoLigado || !busca || !lista) return;
  campoLigado = true;

  busca.addEventListener('focus', () => {
    destacado = -1;
    pintarLista();
  });

  busca.addEventListener('input', () => {
    // Digitou: o que estava escolhido deixa de valer até escolher de novo.
    const oculto = el<HTMLInputElement>('reservar-projeto');
    if (oculto) oculto.value = '';
    show(el('reservar-projeto-erro'), false);
    busca.removeAttribute('aria-invalid');
    destacado = 0;
    pintarLista();
  });

  busca.addEventListener('keydown', (ev) => {
    const aberta = !lista.hidden;
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      destacado = aberta ? Math.min(visiveis.length - 1, destacado + 1) : 0;
      pintarLista();
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      destacado = Math.max(0, destacado - 1);
      pintarLista();
    } else if (ev.key === 'Enter') {
      // Enter com a lista aberta escolhe; não envia o formulário.
      if (aberta) {
        ev.preventDefault();
        const projeto = visiveis[Math.max(0, destacado)];
        if (projeto) escolherProjeto(projeto);
        abrirLista(false);
      }
    } else if (ev.key === 'Escape' && aberta) {
      // Fecha só a lista, não o modal.
      ev.preventDefault();
      ev.stopPropagation();
      abrirLista(false);
    }
  });

  // mousedown, e não click: o click chegaria depois do blur fechar a lista.
  lista.addEventListener('mousedown', (ev) => {
    const opcao = (ev.target as HTMLElement).closest<HTMLElement>('[data-indice]');
    if (!opcao) return;
    ev.preventDefault();
    const projeto = visiveis[Number(opcao.dataset.indice)];
    if (projeto) escolherProjeto(projeto);
    abrirLista(false);
  });

  busca.addEventListener('blur', () => {
    abrirLista(false);
    // Escreveu o nome inteiro sem clicar na sugestão: vale do mesmo jeito.
    if (!valor('reservar-projeto')) {
      const exato = projetosDaLista.find((p) => normalizar(p.titulo) === normalizar(busca.value));
      if (exato) escolherProjeto(exato);
    }
  });
}

/**
 * Recebe os projetos em que a pessoa pode reservar. Mantém o que já estava
 * escolhido (ou veio do rascunho antes da lista chegar); com um projeto só,
 * ele já vem escolhido.
 */
function pintarProjetos(lista: ProjetoDoCampo[]): void {
  ligarCampoDeProjeto();

  const lideres = new Map(projetosParaReservar().map((p) => [p.id, p.responsavel?.nome]));
  projetosDaLista = [...lista]
    .sort((a, b) => a.titulo.localeCompare(b.titulo, 'pt-BR'))
    .map((p) => ({ ...p, lider: lideres.get(p.id) ?? undefined }));

  const escolhido = valor('reservar-projeto');
  const atual = projetosDaLista.find((p) => String(p.id) === escolhido)
    ?? (projetosDaLista.length === 1 ? projetosDaLista[0] : null);
  escolherProjeto(atual);

  const busca = campoBusca();
  if (busca) {
    busca.placeholder = projetosDaLista.length ? 'Digite para buscar o projeto' : 'Nenhum projeto disponível';
    busca.disabled = !projetosDaLista.length;
  }

  // A lista chegou com o campo já aberto (clicou antes de carregar): redesenha.
  if (busca && document.activeElement === busca) pintarLista();

  const ajuda = el('reservar-projeto-ajuda');
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
  'reservar-quantidade-extra',
  'reservar-selecionar-vaso',
  'reservar-selecionar-bancada',
  'reservar-projeto',
  'reservar-finalidade',
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
    if (id.startsWith('reservar-selecionar-')) {
      const check = el<HTMLInputElement>(id);
      return v === 'true' && check?.dataset.padrao !== 'true';
    }
    if (id.startsWith('reservar-quantidade')) return v !== '' && v !== '1';
    return v !== '';
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

    const campo = el<HTMLInputElement | HTMLSelectElement>(id);
    if (!campo) continue;
    if (campo instanceof HTMLInputElement && campo.type === 'checkbox') campo.checked = guardado === 'true';
    else campo.value = guardado;
    // Select cujas opções ainda não chegaram: guarda para pintarProjetos.
    if (campo instanceof HTMLSelectElement) campo.dataset.desejado = guardado;
    restaurou = true;
  }

  // Rascunhos gravados antes do seletor múltiplo usavam uma unidade e uma
  // quantidade. Redistribui esses dois valores para a linha correspondente.
  const unidadeAntiga = rascunho.campos['reservar-unidade-valor'];
  const quantidadeAntiga = rascunho.campos['reservar-quantidade'];
  if (unidadeAntiga === 'VASO' || unidadeAntiga === 'BANCADA') {
    const estufa = ESTUFAS[estufaId];
    if (estufa?.unidades.length > 1) {
      for (const unidade of estufa.unidades) {
        const check = el<HTMLInputElement>(`reservar-selecionar-${chaveDaUnidade(unidade)}`);
        if (check) check.checked = unidade === unidadeAntiga;
      }
    }
    const quantidade = campoDaQuantidade(unidadeAntiga);
    if (quantidade && quantidadeAntiga) quantidade.value = quantidadeAntiga;
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
  const campo = el<HTMLInputElement>(id);
  if (campo?.type === 'checkbox') return String(campo.checked);
  return (campo?.value ?? '').trim();
}

function numero(id: string): number {
  const bruto = Number.parseInt(valor(id), 10);
  return Number.isNaN(bruto) ? 0 : bruto;
}

/* ---------------------------------------------------------------------------
   Vasos e bancadas

   Cada unidade tem sua quantidade própria. Nas estufas com as duas, a pessoa
   marca uma ou ambas e envia tudo junto; com uma só, aparece apenas o campo
   daquela unidade.
   ------------------------------------------------------------------------ */

function nomeDaUnidade(unidade: UnidadeCapacidade): string {
  return unidade === 'BANCADA' ? 'bancadas' : 'vasos';
}

function chaveDaUnidade(unidade: UnidadeCapacidade): 'vaso' | 'bancada' {
  return unidade === 'BANCADA' ? 'bancada' : 'vaso';
}

function idDaQuantidade(indice: number): string {
  return indice === 0 ? 'reservar-quantidade' : 'reservar-quantidade-extra';
}

function campoDaQuantidade(unidade: UnidadeCapacidade): HTMLInputElement | null {
  return qs<HTMLInputElement>(`[data-unidade-quantidade="${unidade}"]`, el('reservar-unidades') ?? document);
}

function unidadeMarcada(unidade: UnidadeCapacidade): boolean {
  const estufa = espacoDaReserva ? ESTUFAS[espacoDaReserva] : null;
  if (!estufa) return false;
  if (estufa.unidades.length === 1) return estufa.unidades[0] === unidade;
  return el<HTMLInputElement>(`reservar-selecionar-${chaveDaUnidade(unidade)}`)?.checked ?? false;
}

function unidadesMarcadas(): UnidadeCapacidade[] {
  const estufa = espacoDaReserva ? ESTUFAS[espacoDaReserva] : null;
  return estufa?.unidades.filter(unidadeMarcada) ?? [];
}

/** "5 vasos livres · 7 bancadas livres" — tudo o que sobra hoje. */
function livresDaEstufa(estufa: Estufa): string {
  return estufa.unidades
    .map((u) => ocupacaoResumo(estufa.livrePor[u] ?? 0, estufa.capacidadePor[u] ?? 0, u))
    .join(' · ');
}

function pintarUnidades(estufa: Estufa, unidadeInicial: UnidadeCapacidade): void {
  const multipla = estufa.unidades.length > 1;
  show(el('reservar-unidades-campo'), true);
  setText('reservar-unidades-rotulo', multipla ? 'O que você quer reservar' : 'Quantas unidades você precisa');
  const grupo = el('reservar-unidades');
  if (!grupo) return;

  grupo.innerHTML = juntar(estufa.unidades.map((u, indice) => {
    const livre = estufa.livrePor[u] ?? 0;
    const selecionada = multipla ? u === unidadeInicial : true;
    const capacidade = estufa.capacidadePor[u] ?? 0;
    const nome = u === 'BANCADA' ? 'bancadas' : 'vasos';
    const nomeNoSingular = u === 'BANCADA' ? 'bancada' : 'vaso';
    const titulo = u === 'BANCADA' ? 'Bancadas' : 'Vasos';
    const checkId = `reservar-selecionar-${chaveDaUnidade(u)}`;
    const quantidadeId = idDaQuantidade(indice);
    const sufixoId = indice === 0 ? 'reservar-unidade' : 'reservar-unidade-extra';
    return html`
      <div class="reserva-unidade" data-unidade-linha="${u}" data-selecionada="${String(selecionada)}">
        ${raw(multipla
          ? html`<label class="reserva-unidade__opcao" for="${checkId}">
              <input type="checkbox" id="${checkId}" data-action="reservar-unidade" data-unidade="${u}"
                     data-padrao="${String(selecionada)}" ${raw(selecionada ? 'checked' : '')} />
              <span class="reserva-unidade__texto">
                <strong>${titulo}</strong>
                <span>${livre} ${livre === 1 ? nomeNoSingular : nome} ${livre === 1 ? 'livre' : 'livres'} hoje · capacidade total: ${capacidade}</span>
              </span>
            </label>`
          : html`<div class="reserva-unidade__opcao">
              <span class="reserva-unidade__texto"><strong>${titulo}</strong><span>${livre} ${livre === 1 ? nomeNoSingular : nome} ${livre === 1 ? 'livre' : 'livres'} hoje</span></span>
            </div>`)}
        <div class="field__inline reserva-unidade__quantidade">
          <label class="sr-only" for="${quantidadeId}">Quantidade de ${nome}</label>
          <input class="input input--numero" type="number" id="${quantidadeId}" data-unidade-quantidade="${u}"
                 min="1" max="${String(Math.max(1, livre))}" step="1" value="1" required
                 aria-describedby="reservar-quantidade-ajuda"
                 ${raw(multipla && !selecionada ? 'disabled' : '')} />
          <span class="field__sufixo" id="${sufixoId}">${nome}</span>
        </div>
      </div>`;
  }));
}

function sincronizarLinhasDeUnidade(estufa: Estufa): void {
  for (const unidade of estufa.unidades) {
    const check = el<HTMLInputElement>(`reservar-selecionar-${chaveDaUnidade(unidade)}`);
    const selecionada = estufa.unidades.length === 1 || Boolean(check?.checked);
    const linha = qs<HTMLElement>(`[data-unidade-linha="${unidade}"]`, el('reservar-unidades') ?? document);
    const quantidade = campoDaQuantidade(unidade);
    if (quantidade) quantidade.disabled = estufa.unidades.length > 1 && !selecionada;
    linha?.setAttribute('data-selecionada', String(selecionada));
  }
}

function selecionarApenasUnidade(estufa: Estufa, escolhida: UnidadeCapacidade): void {
  for (const unidade of estufa.unidades) {
    const check = el<HTMLInputElement>(`reservar-selecionar-${chaveDaUnidade(unidade)}`);
    if (check) check.checked = unidade === escolhida;
  }
  sincronizarLinhasDeUnidade(estufa);
}

/** Atualiza a linha e reconsulta quando a pessoa marca ou desmarca uma unidade. */
export function alternarUnidade(unidade: string | undefined): void {
  if (unidade !== 'VASO' && unidade !== 'BANCADA') return;

  const estufa = espacoDaReserva ? ESTUFAS[espacoDaReserva] : null;
  if (!estufa) return;
  sincronizarLinhasDeUnidade(estufa);

  void consultarDisponibilidade();
  guardarRascunhoDaReserva();
}

/* ===========================================================================
   Reservar
   =========================================================================== */

/**
 * `datas` vem do calendário: a pessoa já escolheu o dia (ou o período) lá.
 * Nesse caso a estufa estar cheia HOJE não impede — o que vale é o período
 * pedido, e quem confere isso é a consulta de disponibilidade.
 */
export function abrirModalReservar(
  estufaId: string,
  datas?: { inicio: string; fim: string; unidade?: UnidadeCapacidade },
): void {
  const estufa = ESTUFAS[estufaId];
  if (!estufa) return;

  const paraOFuturo = Boolean(datas && datas.inicio > hojeISO());

  if (paraOFuturo ? estufa.situacao !== 'ATIVA' : !aceitaReserva(estufa)) {
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
  const temperatura = estufa.temperaturaMin !== null || estufa.temperaturaMax !== null
    ? temperaturaTexto(estufa.temperaturaMin, estufa.temperaturaMax)
    : '';
  setText('reservar-descricao', [estufa.codigo, estufa.desc || estufa.tipo, temperatura].filter(Boolean).join(' · '));
  setText('reservar-area', estufa.area);
  setText('reservar-bancadas', plural(estufa.cap, 'bancada', 'bancadas'));
  setText('reservar-capacidade', livresDaEstufa(estufa));

  const status = el('reservar-status');
  if (status) status.innerHTML = html`${statusPill(estufa.status)}`;

  const marca = el('reservar-marca');
  if (marca) marca.innerHTML = html`${icone(estufa.icon)}`;

  el<HTMLFormElement>('form-reservar')?.reset();
  // reset() não limpa campo oculto: o projeto da reserva anterior ficaria.
  const projetoOculto = el<HTMLInputElement>('reservar-projeto');
  if (projetoOculto) projetoOculto.value = '';
  show(el('reservar-projeto-erro'), false);
  campoBusca()?.removeAttribute('aria-invalid');
  prepararCamposDaReserva();

  // Começa pela unidade em foco no calendário; senão, pela primeira com vaga.
  // A outra unidade continua disponível para ser marcada no mesmo envio.
  const unidadeInicial = datas?.unidade && estufa.unidades.includes(datas.unidade)
    ? datas.unidade
    : unidadesComVaga(estufa)[0] ?? estufa.unidades[0] ?? estufa.unidade;
  pintarUnidades(estufa, unidadeInicial);

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
    if (datas?.unidade && estufa.unidades.includes(datas.unidade)) selecionarApenasUnidade(estufa, datas.unidade);
    else sincronizarLinhasDeUnidade(estufa);
    // O rascunho guarda o id; o nome no campo de busca vem da lista.
    if (projetosDoCampo) pintarProjetos(projetosDoCampo);
    if (!datas) aviso('Recuperei o que você já tinha preenchido nesta reserva.', 'info');
    ajustarFimDoPeriodo();
  } else {
    sincronizarLinhasDeUnidade(estufa);
  }

  // As datas escolhidas no calendário valem mais do que as do rascunho.
  if (datas && datas.inicio >= hoje && inicio && fim) {
    inicio.value = datas.inicio;
    fim.value = datas.fim < datas.inicio ? datas.inicio : datas.fim;
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

  try {
    const escolhidas = unidadesMarcadas();
    if (!escolhidas.length) {
      mostrarAviso('Marque vasos, bancadas ou os dois para continuar.', 'erro');
      return;
    }

    const respostas = await Promise.all(escolhidas.map(async (unidade) => {
      const quantidade = campoDaQuantidade(unidade);
      const resposta = await getDisponibilidade(casaId, {
        de: inicio,
        ate: fim,
        quantidade: Number.parseInt(quantidade?.value ?? '', 10) || undefined,
        unidade,
      });
      if (quantidade) quantidade.max = String(Math.max(1, resposta.disponivel));
      return { unidade, resposta };
    }));

    mostrarAviso(
      respostas.map(({ unidade, resposta }) => `${nomeDaUnidade(unidade)}: ${resposta.mensagem}`).join(' '),
      respostas.some(({ resposta }) => resposta.cabe === false) ? 'erro' : 'ok',
    );
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
  const itens = unidadesMarcadas().map((unidade) => ({
    unidade,
    quantidade: Number.parseInt(campoDaQuantidade(unidade)?.value ?? '', 10) || 0,
  }));

  if (!inicio || !fim || !finalidade) {
    aviso('Preencha o período e a finalidade.', 'error');
    return;
  }

  const campoProjeto = campoBusca();
  const projetoEscolhido = acharProjeto(projeto);

  if (!projetoEscolhido) {
    campoProjeto?.setAttribute('aria-invalid', 'true');
    show(el('reservar-projeto-erro'), true);
    campoProjeto?.focus();
    aviso(
      'Escolha para qual projeto é a reserva.',
      'error',
    );
    return;
  }
  campoProjeto?.removeAttribute('aria-invalid');

  if (!itens.length) {
    aviso('Marque vasos, bancadas ou os dois para continuar.', 'error');
    return;
  }

  const itemInvalido = itens.find((item) => item.quantidade < 1);
  if (itemInvalido) {
    const campoQuantidade = campoDaQuantidade(itemInvalido.unidade);
    campoQuantidade?.setAttribute('aria-invalid', 'true');
    campoQuantidade?.focus();
    aviso(`Informe a quantidade de ${nomeDaUnidade(itemInvalido.unidade)}.`, 'error');
    return;
  }
  for (const item of itens) campoDaQuantidade(item.unidade)?.removeAttribute('aria-invalid');

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
      inicio, fim, projeto: String(projetoEscolhido.id), finalidade, itens,
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
  itens: { unidade: UnidadeCapacidade; quantidade: number }[];
}

/** Grava a reserva no banco e recarrega o estado do que a API respondeu. */
async function reservarNaApi(estufaId: string, dados: DadosReserva): Promise<string> {
  const casaId = ID_REAL_ESPACO[estufaId];
  if (!casaId) throw new Error('Espaço sem vínculo com o cadastro; recarregue a página.');

  const resposta = await criarReservasEmLote({
    casa_vegetacao_id: casaId,
    itens: dados.itens,
    data_inicio: dados.inicio,
    data_fim: dados.fim,
    finalidade: dados.finalidade,
    // O projeto precisa constar para a API conferir a permissão.
    projeto_id: Number(dados.projeto),
  });

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
  setText(
    'ver-reserva-descricao',
    estufa ? [estufa.codigo, estufa.tipo].filter(Boolean).join(' · ') : 'Espaço não encontrado',
  );
  setText('ver-reserva-codigo', reserva.id);
  setText('ver-reserva-inicio', dataBR(reserva.data));
  setText('ver-reserva-fim', dataBR(reserva.dataFim));
  setText(
    'ver-reserva-quantidade',
    capacidade(reserva.quantidade, reserva.unidade),
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
    estufa ? capacidade(estufa.capacidadePor[reserva.unidade] ?? 0, reserva.unidade) : '—',
  );
  setText('editar-reserva-unidade', nomeDaUnidade(reserva.unidade));

  preencher('editar-reserva-inicio', reserva.data);
  preencher('editar-reserva-fim', reserva.dataFim);
  preencher('editar-reserva-quantidade', String(reserva.quantidade));
  preencher('editar-reserva-finalidade', reserva.finalidade ?? '');

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
      unidade: reserva.unidade,
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
    });

    // O back-end diz se a alteração devolveu a reserva para a fila.
    mensagem = resposta?.message ?? mensagem;

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
