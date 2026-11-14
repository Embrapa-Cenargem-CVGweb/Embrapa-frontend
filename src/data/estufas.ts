/**
 * Estado dos espaços e das reservas.
 *
 * `ESTUFAS` e `reservas` são mutados no lugar (nunca reatribuídos), para que
 * quem importou continue vendo a mesma referência.
 *
 * Os dados vêm da API Laravel (`VITE_API_URL`) e toda alteração é gravada lá.
 * Não existe fonte local: se a API não responde, a tela diz isso em vez de
 * mostrar um inventário de exemplo.
 *
 * A chave do mapa (E01, E02...) é a POSIÇÃO do espaço na foto aérea, definida
 * em `hotspots.ts`. O código real do cadastro (CVG01) fica em `estufa.codigo`
 * e é o que aparece nas telas — antes a interface mostrava E05 onde o banco
 * dizia CVG05.
 */
import type { Estufa, Estufas, EstufaStatus, Reserva, UnidadeCapacidade } from '../types';
import { dadosMudaram } from '../lib/bus';
import { getCalendario, getCasasVegetacao, getReservas, type CalendarioOcupacao } from '../services/api';
import { hojeISO } from '../lib/format';

export const ESTUFAS: Estufas = {};
/** Reservas que a pessoa logada pode ver e mexer: é a lista da tela de Reservas. */
export const reservas: Reserva[] = [];
/**
 * Ocupação de TODAS as estufas, de hoje em diante, venha de quem vier.
 *
 * É com isto que o mapa pinta as estufas e a ficha conta os vasos. Antes a
 * conta saía de `reservas`, que o back-end filtra por pessoa: o pesquisador
 * não via a reserva de um projeto que não era dele e a estufa lotada aparecia
 * verde para ele e laranja para o administrador. A ocupação é a mesma para
 * todo mundo — é o que o calendário já mostrava.
 */
export const agenda: Reserva[] = [];

/** Quantos dias à frente a agenda cobre (o back-end aceita até 100 por consulta). */
const DIAS_DE_AGENDA = 99;

function somarDias(iso: string, dias: number): string {
  const data = new Date(`${iso}T12:00:00Z`);
  data.setUTCDate(data.getUTCDate() + dias);
  return data.toISOString().slice(0, 10);
}

/**
 * Código da interface (E01, R001) para o id real do banco. A API precisa do id
 * numérico ao criar, aprovar ou cancelar; a interface só conhece a posição.
 */
export const ID_REAL_ESPACO: Record<string, number> = {};
export const ID_REAL_RESERVA: Record<string, number> = {};

/** Quando os dados foram lidos pela última vez (epoch ms). 0 = nunca. */
let lidoEm = 0;

export function ultimaLeitura(): number {
  return lidoEm;
}

/* ===========================================================================
   API
   =========================================================================== */

interface OcupacaoApi {
  capacidade_total?: number;
  ocupado?: number;
  disponivel?: number;
  unidade?: UnidadeCapacidade;
}

interface CasaApi {
  id: number;
  codigo?: string;
  descricao?: string;
  tipo?: string;
  localizacao?: string;
  area_m2?: number;
  capacidade?: number;
  unidade_capacidade?: UnidadeCapacidade;
  capacidade_total?: number;
  vasos?: { tamanho_cm: number; quantidade: number }[] | null;
  temperatura_min?: number | null;
  temperatura_max?: number | null;
  motivo_situacao?: string | null;
  obs?: string;
  status?: Estufa['situacao'];
  ativa?: boolean;
  ocupacao?: OcupacaoApi;
}

interface ReservaApi {
  id: number;
  casa_vegetacao_id: number;
  quantidade?: number;
  unidade?: UnidadeCapacidade;
  data_inicio?: string;
  data_fim?: string;
  projeto?: { codigo?: string; titulo?: string };
  projeto_id?: number | string;
  funcionario?: { nome?: string };
  finalidade?: string;
  obs?: string;
  status?: string;
}

/** A API devolve o status em maiúsculas; aqui ele vira a chave da interface. */
function statusDaReserva(bruto: string | undefined): Reserva['status'] {
  const valor = String(bruto ?? 'ativa').toLowerCase();
  if (valor === 'cancelada') return 'cancelada';
  if (valor === 'pendente') return 'pendente';
  return 'ativa';
}

/** Ícone por tipo de espaço, como no inventário local. */
function iconeDoTipo(tipo: string): string {
  if (tipo.toLowerCase().includes('telado')) return 'fence';
  if (tipo.toLowerCase().includes('climatizada')) return 'sprout';
  return 'leaf';
}

/**
 * `aoFalhar` decide o que acontece quando a API não responde: 'avisar' só
 * registra e deixa a tela com o que já tinha (no primeiro carregamento, vazia);
 * 'manter' propaga o erro, para quem gravou algo poder dizer que não deu.
 */
export async function carregarEstado(aoFalhar: 'avisar' | 'manter' = 'avisar'): Promise<void> {
  try {
    const hoje = hojeISO();
    const [casasResposta, reservasResposta, calendario] = await Promise.all([
      getCasasVegetacao(),
      getReservas(),
      // Sem a agenda o mapa ainda sobe, com o que a pessoa enxerga.
      getCalendario(hoje, somarDias(hoje, DIAS_DE_AGENDA)).catch((erro): CalendarioOcupacao | null => {
        console.warn('[CVGWeb] não consegui ler a ocupação geral; usando só as reservas visíveis:', erro);
        return null;
      }),
    ]);

    for (const chave of Object.keys(ESTUFAS)) delete ESTUFAS[chave];
    for (const chave of Object.keys(ID_REAL_ESPACO)) delete ID_REAL_ESPACO[chave];
    for (const chave of Object.keys(ID_REAL_RESERVA)) delete ID_REAL_RESERVA[chave];
    reservas.length = 0;

    // Ordena pelo código do cadastro para que a posição no mapa (E01, E02...)
    // siga sempre a mesma ordem, independente de como o backend devolveu.
    const casas: CasaApi[] = (casasResposta.data ?? casasResposta)
      .slice()
      .sort((a: CasaApi, b: CasaApi) => (a.codigo ?? '').localeCompare(b.codigo ?? '') || a.id - b.id);

    const chavePorId: Record<number, string> = {};

    casas.forEach((casa, indice) => {
      // A posição no mapa vem do NÚMERO do código (CVG05 -> E05), não da
      // ordem da lista: cadastrar uma estufa nova não pode deslocar os
      // marcadores das outras na foto aérea. Código fora do padrão cai na
      // ordem da lista, e quem não tem posição simplesmente não aparece no
      // mapa — continua na administração.
      const numero = Number.parseInt(casa.codigo?.replace(/\D/g, '') ?? '', 10);
      let chave = `E${String(Number.isNaN(numero) ? indice + 1 : numero).padStart(2, '0')}`;

      // Dois códigos com o mesmo número não podem ocupar a mesma chave.
      while (ESTUFAS[chave]) chave = `${chave}b`;
      chavePorId[casa.id] = chave;
      ID_REAL_ESPACO[chave] = casa.id;

      // Tipo em aberto até a administração informar: vazio, não um palpite.
      const tipo = casa.tipo?.trim() ?? '';
      const capacidadeTotal = casa.ocupacao?.capacidade_total ?? casa.capacidade_total ?? 0;
      const unidade = casa.ocupacao?.unidade ?? casa.unidade_capacidade ?? 'VASO';
      const bancadas = casa.capacidade ?? 0;
      // Mesma regra do back-end (CasaVegetacao::capacidadeEm): a principal usa
      // a capacidade reservável; numa estufa de vasos, as bancadas contam à parte.
      const capacidadePor: Partial<Record<UnidadeCapacidade, number>> = { [unidade]: capacidadeTotal };
      if (unidade === 'VASO' && bancadas > 0) capacidadePor.BANCADA = bancadas;

      ESTUFAS[chave] = {
        codigo: casa.codigo ?? chave,
        nome: casa.descricao ?? casa.codigo ?? chave,
        tipo,
        setor: casa.localizacao ?? '—',
        // Recalculado abaixo, depois de as reservas entrarem na lista.
        status: 'livre',
        situacao: casa.status ?? (casa.ativa === false ? 'MANUTENCAO' : 'ATIVA'),
        area: casa.area_m2 ? `${casa.area_m2} m²` : '—',
        cap: casa.capacidade ?? 0,
        unidade,
        capacidadeTotal,
        ocupado: casa.ocupacao?.ocupado ?? 0,
        disponivel: casa.ocupacao?.disponivel ?? capacidadeTotal,
        unidades: Object.keys(capacidadePor) as UnidadeCapacidade[],
        capacidadePor,
        livrePor: { ...capacidadePor },
        icon: iconeDoTipo(tipo),
        desc: casa.obs ?? '',
        vasos: (casa.vasos ?? []).map((v) => ({ tamanho_cm: Number(v.tamanho_cm), quantidade: Number(v.quantidade) })),
        temperaturaMin: casa.temperatura_min ?? null,
        temperaturaMax: casa.temperatura_max ?? null,
        motivo: casa.motivo_situacao ?? '',
      };
    });

    const lista: ReservaApi[] = reservasResposta.data ?? reservasResposta;
    for (const item of lista) {
      const codigo = `R${String(item.id).padStart(3, '0')}`;
      ID_REAL_RESERVA[codigo] = item.id;

      reservas.push({
        id: codigo,
        estufaId: chavePorId[item.casa_vegetacao_id] ?? '',
        data: item.data_inicio?.slice(0, 10) ?? '',
        dataFim: item.data_fim?.slice(0, 10) ?? '',
        quantidade: item.quantidade ?? 1,
        unidade: item.unidade
          ?? (chavePorId[item.casa_vegetacao_id] ? ESTUFAS[chavePorId[item.casa_vegetacao_id]].unidade : 'VASO'),
        projeto: item.projeto?.codigo ?? String(item.projeto_id ?? ''),
        projetoTitulo: item.projeto?.titulo ?? '',
        finalidade: item.finalidade ?? '',
        obs: item.obs ?? '',
        pesquisador: item.funcionario?.nome ?? '',
        status: statusDaReserva(item.status),
      });
    }

    // Agenda geral: todas as reservas vigentes, de qualquer projeto.
    agenda.length = 0;
    if (calendario) {
      for (const casa of calendario.casas) {
        const chave = chavePorId[casa.id];
        if (!chave) continue;
        for (const r of casa.reservas) {
          agenda.push({
            id: `R${String(r.id).padStart(3, '0')}`,
            estufaId: chave,
            data: r.inicio,
            dataFim: r.fim,
            quantidade: r.quantidade,
            unidade: r.unidade === 'BANCADA' ? 'BANCADA' : 'VASO',
            projeto: r.projeto_codigo ?? '',
            projetoTitulo: r.projeto ?? '',
            finalidade: r.finalidade ?? '',
            obs: '',
            pesquisador: r.responsavel ?? '',
            status: r.status === 'PENDENTE' ? 'pendente' : 'ativa',
          });
        }
      }
    } else {
      agenda.push(...reservas.filter((r) => r.status !== 'cancelada' && r.estufaId !== ''));
    }

    recalcularOcupacao();
    lidoEm = Date.now();
  } catch (erro) {
    if (aoFalhar === 'manter') {
      console.warn('[CVGWeb] falha ao reler da API; mantendo o estado atual:', erro);
      throw erro;
    }
    console.error('[CVGWeb] falha ao carregar da API:', erro);
  }
}

/** Força a próxima consulta a reler da API. */
export function invalidarEstado(): void {
  lidoEm = 0;
}

/**
 * Garante que o estado não está velho antes de alguém consultá-lo.
 *
 * O assistente chama isto antes de cada pergunta: as reservas mudam o tempo
 * todo e quem respondeu "a E03 está livre" dois minutos atrás pode estar
 * errado agora.
 *
 * Releituras seguidas dentro da janela são ignoradas, para que uma sequência
 * de perguntas não vire uma sequência de chamadas à API.
 */
export async function garantirEstadoFresco(janelaMs = 15_000): Promise<void> {
  if (lidoEm && Date.now() - lidoEm < janelaMs) return;

  try {
    await carregarEstado('manter');
  } catch {
    // Sem rede, responde com o último estado conhecido: o campo "Atualização"
    // do prompt mostra de quando ele é.
    return;
  }

  // Mapa, marcadores e administração acompanham o que o assistente leu.
  dadosMudaram();
}

/* ===========================================================================
   Ocupação
   =========================================================================== */

/**
 * Recalcula quanto de cada espaço está tomado HOJE e qual situação mostrar.
 *
 * Esta é a conta que estava errada: o código antigo comparava `r.data === hoje`
 * e só marcava o espaço como ocupado quando a reserva COMEÇAVA no dia. Uma
 * reserva de 01/11 a 20/11 deixava o espaço "livre" no dia 5.
 *
 * Agora conta todas as reservas vigentes cujo período cobre hoje e soma as
 * quantidades — é o mesmo critério do back-end.
 */
export function recalcularOcupacao(data = hojeISO()): void {
  for (const [chave, estufa] of Object.entries(ESTUFAS)) {
    const doDia = reservasDoEspaco(chave, data);
    const tomado = (unidade: UnidadeCapacidade): number => doDia
      .filter((r) => r.unidade === unidade)
      .reduce((total, r) => total + (r.quantidade || 1), 0);

    for (const unidade of estufa.unidades) {
      estufa.livrePor[unidade] = Math.max(0, (estufa.capacidadePor[unidade] ?? 0) - tomado(unidade));
    }

    estufa.ocupado = tomado(estufa.unidade);
    estufa.disponivel = estufa.livrePor[estufa.unidade] ?? 0;
    // Bancada reservada também tira a estufa de "livre".
    estufa.algoReservado = doDia.length > 0;

    // Lotaria só com as aprovadas? Então está ocupada; se o que completa a
    // conta são pedidos esperando a administração, está reservada.
    const aprovado = doDia
      .filter((r) => r.status === 'ativa' && r.unidade === estufa.unidade)
      .reduce((total, r) => total + (r.quantidade || 1), 0);
    const capacidadePrincipal = estufa.capacidadePor[estufa.unidade] ?? 0;
    const lotadaPorAprovadas = capacidadePrincipal > 0 && aprovado >= capacidadePrincipal;

    estufa.status = situacaoVisivel(estufa, lotadaPorAprovadas);
  }
}

/**
 * Situação que a interface mostra, derivada da cadastral e da ocupação.
 *
 * A cadastral manda sempre que não é ATIVA: um espaço que a administração
 * marcou como reservado ou ocupado não aparece livre só porque não há reserva
 * registrada nele. Com ATIVA, quem decide é a ocupação do dia.
 *
 * As cores do mapa, pela ocupação do dia:
 * - verde (livre/parcial): sobra vaga na unidade principal;
 * - laranja (ocupada): a unidade principal lotou com reservas já aprovadas;
 * - azul (reservada): lotou, mas parte disso é pedido que a administração
 *   ainda não aprovou.
 * Conta a unidade principal (os vasos, na estufa de vasos): bancadas avulsas
 * que sobram não deixam a estufa verde. Antes ela só saía do verde quando
 * vasos E bancadas acabavam — a Estufa 01 com os 9 vasos tomados seguia
 * "parcial", pintada como livre.
 */
function situacaoVisivel(estufa: Estufa, lotadaPorAprovadas: boolean): EstufaStatus {
  if (estufa.situacao === 'MANUTENCAO') return 'manutencao';
  if (estufa.situacao === 'INATIVA') return 'inativa';
  if (estufa.situacao === 'RESERVADA') return 'reservada';
  if (estufa.situacao === 'OCUPADA') return 'ocupada';
  if (!estufa.algoReservado) return 'livre';
  if (!principalEsgotada(estufa) && unidadesComVaga(estufa).length > 0) return 'parcial';
  return lotadaPorAprovadas ? 'ocupada' : 'reservada';
}

/** A unidade principal tem capacidade e não sobra nada dela hoje. */
export function principalEsgotada(estufa: Estufa): boolean {
  return (estufa.capacidadePor[estufa.unidade] ?? 0) > 0 && (estufa.livrePor[estufa.unidade] ?? 0) <= 0;
}

/**
 * O dia mais cheio da unidade, de hoje em diante: quanto fica tomado e desde
 * quando. A ficha mostra isso ao lado do "em uso hoje" — uma reserva de 10
 * vasos que começa na semana que vem não aparece no número de hoje, e sem
 * este aviso parecia que ela não tinha sido contada.
 */
export function picoDeUso(
  estufaId: string,
  unidade?: UnidadeCapacidade,
  desde = hojeISO(),
): { tomado: number; dia: string } {
  const estufa = ESTUFAS[estufaId];
  const qual = unidade ?? estufa?.unidade ?? 'VASO';
  const futuras = proximasReservas(estufaId, desde).filter((r) => r.unidade === qual);

  // O total só muda no dia em que alguma reserva começa: basta olhar esses.
  const candidatos = [desde, ...futuras.map((r) => r.data).filter((d) => d > desde)];
  let melhor = { tomado: 0, dia: desde };
  for (const dia of candidatos) {
    const tomado = futuras
      .filter((r) => r.data <= dia && r.dataFim >= dia)
      .reduce((total, r) => total + (r.quantidade || 1), 0);
    if (tomado > melhor.tomado) melhor = { tomado, dia };
  }
  return melhor;
}

/** AAAA-MM-DD do dia seguinte, sem passar por fuso (meio-dia em UTC). */
function diaSeguinte(iso: string): string {
  const data = new Date(`${iso}T12:00:00Z`);
  data.setUTCDate(data.getUTCDate() + 1);
  return data.toISOString().slice(0, 10);
}

/**
 * Primeiro dia, a partir de `desde`, em que sobra alguma coisa da unidade no
 * espaço. É por onde começa o pedido de quem quer reservar uma estufa que
 * está cheia hoje: em vez de cair num período que a API vai recusar, o
 * formulário já abre no dia em que vaga.
 *
 * Pula de fim em fim de reserva, então o laço é curto mesmo com muitas.
 */
export function proximaDataLivre(
  estufaId: string,
  unidade?: UnidadeCapacidade,
  desde = hojeISO(),
): string {
  const estufa = ESTUFAS[estufaId];
  if (!estufa) return desde;

  const qual = unidade ?? estufa.unidade;
  const capacidade = estufa.capacidadePor[qual] ?? 0;
  let data = desde;

  for (let volta = 0; volta < 500; volta += 1) {
    const doDia = reservasDoEspaco(estufaId, data).filter((r) => r.unidade === qual);
    const tomado = doDia.reduce((total, r) => total + (r.quantidade || 1), 0);
    if (!doDia.length || tomado < capacidade) return data;

    const primeiroFim = doDia.reduce((menor, r) => (r.dataFim < menor ? r.dataFim : menor), doDia[0].dataFim);
    data = diaSeguinte(primeiroFim);
  }

  return data;
}

/** Unidades com alguma coisa livre hoje, a principal primeiro. */
export function unidadesComVaga(estufa: Estufa): UnidadeCapacidade[] {
  return estufa.unidades.filter((u) => (estufa.livrePor[u] ?? 0) > 0);
}

/** O espaço aceita nova reserva? Capacidade cheia ou fora de uso, não. */
export function aceitaReserva(estufa: Estufa): boolean {
  return estufa.situacao === 'ATIVA' && unidadesComVaga(estufa).length > 0;
}

/* ===========================================================================
   Consultas
   =========================================================================== */

/**
 * Reservas da pessoa que ainda valem: nem canceladas, nem de espaços
 * inexistentes. É a lista da tela de Reservas — para ocupação, use a agenda.
 */
export function reservasVigentes(): Reserva[] {
  return reservas.filter((r) => r.status !== 'cancelada' && r.estufaId !== '');
}

/** A pessoa logada pode abrir esta reserva? (Só as que vieram na lista dela.) */
export function reservaVisivel(id: string): boolean {
  return reservas.some((r) => r.id === id);
}

/**
 * Reservas vigentes de um espaço que cobrem a data informada.
 *
 * Plural de propósito: com a reserva parcial, várias pessoas dividem a mesma
 * estufa no mesmo período. A versão antiga devolvia só a primeira e escondia
 * as demais da coluna "Reservado por".
 */
export function reservasDoEspaco(estufaId: string, data = hojeISO()): Reserva[] {
  return agenda
    .filter((r) => r.estufaId === estufaId && r.data <= data && r.dataFim >= data)
    .sort((a, b) => b.quantidade - a.quantidade);
}

/** Todas as reservas vigentes de um espaço, de hoje em diante. */
export function proximasReservas(estufaId: string, data = hojeISO()): Reserva[] {
  return agenda
    .filter((r) => r.estufaId === estufaId && r.dataFim >= data)
    .sort((a, b) => a.data.localeCompare(b.data));
}

