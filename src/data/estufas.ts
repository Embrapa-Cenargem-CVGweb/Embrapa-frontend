/**
 * Estado dos espaços e das reservas.
 *
 * `ESTUFAS` e `reservas` são mutados no lugar (nunca reatribuídos), para que
 * quem importou continue vendo a mesma referência.
 *
 * Em modo demonstração os dados vêm de `mock.ts` e as alterações ficam no
 * localStorage. Com `VITE_API_URL` configurada, vêm da API Laravel e toda
 * alteração é gravada lá.
 *
 * A chave do mapa (E01, E02...) é a POSIÇÃO do espaço na foto aérea, definida
 * em `hotspots.ts`. O código real do cadastro (CVG01) fica em `estufa.codigo`
 * e é o que aparece nas telas — antes a interface mostrava E05 onde o banco
 * dizia CVG05.
 */
import type { Estufa, Estufas, EstufaStatus, Reserva, UnidadeCapacidade } from '../types';
import { dadosMudaram } from '../lib/bus';
import { getCasasVegetacao, getReservas } from '../services/api';
import { MOCK_ESTUFAS, MOCK_RESERVAS } from './mock';
import { hojeISO } from '../lib/format';
import { MODO_DEMO } from '../lib/ambiente';

export const ESTUFAS: Estufas = {};
export const reservas: Reserva[] = [];

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

// A versão no nome da chave aposenta o estado salvo quando o mock muda de
// formato — sem isso o navegador seguiria mostrando as reservas antigas.
const CHAVES = {
  reservas: 'cvgweb:reservas:v4',
  situacao: 'cvgweb:situacao:v4',
} as const;

/* ===========================================================================
   Modo demonstração
   =========================================================================== */

function carregarMock(): void {
  for (const chave of Object.keys(ESTUFAS)) delete ESTUFAS[chave];
  reservas.length = 0;

  for (const [chave, estufa] of Object.entries(MOCK_ESTUFAS)) {
    ESTUFAS[chave] = { ...estufa, vasos: estufa.vasos ? { ...estufa.vasos } : undefined };
  }
  for (const reserva of MOCK_RESERVAS) reservas.push({ ...reserva });

  restaurarLocal();
  recalcularOcupacao();
}

function restaurarLocal(): void {
  try {
    const salvas = localStorage.getItem(CHAVES.reservas);
    if (salvas) {
      const lidas = JSON.parse(salvas) as Reserva[];
      if (Array.isArray(lidas) && lidas.length) {
        reservas.length = 0;
        for (const reserva of lidas) reservas.push(reserva);
      }
    }

    const situacoes = localStorage.getItem(CHAVES.situacao);
    if (situacoes) {
      const mapa = JSON.parse(situacoes) as Record<string, Estufa['situacao']>;
      for (const [id, valor] of Object.entries(mapa)) {
        if (ESTUFAS[id]) ESTUFAS[id].situacao = valor;
      }
    }
  } catch (erro) {
    console.warn('[CVGWeb] estado local inválido, ignorando:', erro);
  }
}

export function salvarEstado(): void {
  if (!MODO_DEMO) return;
  try {
    const situacoes: Record<string, Estufa['situacao']> = {};
    for (const [id, estufa] of Object.entries(ESTUFAS)) situacoes[id] = estufa.situacao;
    localStorage.setItem(CHAVES.reservas, JSON.stringify(reservas));
    localStorage.setItem(CHAVES.situacao, JSON.stringify(situacoes));
  } catch (erro) {
    console.warn('[CVGWeb] não foi possível salvar o estado:', erro);
  }
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
  vasos_3cm?: number;
  vasos_5cm?: number;
  vasos_10cm?: number;
  obs?: string;
  status?: Estufa['situacao'];
  ativa?: boolean;
  ocupacao?: OcupacaoApi;
}

interface ReservaApi {
  id: number;
  casa_vegetacao_id: number;
  quantidade?: number;
  data_inicio?: string;
  data_fim?: string;
  projeto?: { codigo?: string };
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
 * `aoFalhar` decide o que acontece quando a API não responde: no primeiro
 * carregamento vale cair no mock, para a tela não subir vazia; numa releitura
 * no meio da sessão não vale — trocar dados reais por dados de exemplo é pior
 * do que continuar com o que já estava na tela.
 */
export async function carregarEstado(aoFalhar: 'mock' | 'manter' = 'mock'): Promise<void> {
  if (MODO_DEMO) {
    console.info('[CVGWeb] modo demonstração: dados locais, sem API.');
    carregarMock();
    lidoEm = Date.now();
    return;
  }

  try {
    const [casasResposta, reservasResposta] = await Promise.all([
      getCasasVegetacao(),
      getReservas(),
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

      const tipo = casa.tipo ?? 'Casa de vegetação';
      const capacidadeTotal = casa.ocupacao?.capacidade_total ?? casa.capacidade_total ?? 0;

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
        unidade: casa.ocupacao?.unidade ?? casa.unidade_capacidade ?? 'VASO',
        capacidadeTotal,
        ocupado: casa.ocupacao?.ocupado ?? 0,
        disponivel: casa.ocupacao?.disponivel ?? capacidadeTotal,
        icon: iconeDoTipo(tipo),
        desc: casa.obs ?? '',
        vasos: casa.vasos_10cm != null
          ? { c3: casa.vasos_3cm ?? 0, c5: casa.vasos_5cm ?? 0, c10: casa.vasos_10cm ?? 0 }
          : undefined,
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
        projeto: item.projeto?.codigo ?? String(item.projeto_id ?? ''),
        finalidade: item.finalidade ?? '',
        obs: item.obs ?? '',
        pesquisador: item.funcionario?.nome ?? '',
        status: statusDaReserva(item.status),
      });
    }

    recalcularOcupacao();
    lidoEm = Date.now();
  } catch (erro) {
    if (aoFalhar === 'manter') {
      console.warn('[CVGWeb] falha ao reler da API; mantendo o estado atual:', erro);
      throw erro;
    }
    console.error('[CVGWeb] falha ao carregar da API; usando dados locais:', erro);
    carregarMock();
    lidoEm = Date.now();
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
 * errado agora. Em modo demonstração não há o que buscar — a memória já é a
 * verdade, e muda junto com cada reserva feita na tela.
 *
 * Releituras seguidas dentro da janela são ignoradas, para que uma sequência
 * de perguntas não vire uma sequência de chamadas à API.
 */
export async function garantirEstadoFresco(janelaMs = 15_000): Promise<void> {
  if (MODO_DEMO) return;
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
    const ocupado = reservasDoEspaco(chave, data)
      .reduce((total, r) => total + (r.quantidade || 1), 0);

    estufa.ocupado = ocupado;
    estufa.disponivel = Math.max(0, estufa.capacidadeTotal - ocupado);
    estufa.status = situacaoVisivel(estufa);
  }
}

/**
 * Situação que a interface mostra, derivada da cadastral e da ocupação.
 *
 * A cadastral manda sempre que não é ATIVA: um espaço que a administração
 * marcou como reservado ou ocupado não aparece livre só porque não há reserva
 * registrada nele. Com ATIVA, quem decide é a ocupação do dia.
 */
export function situacaoVisivel(estufa: Estufa): EstufaStatus {
  if (estufa.situacao === 'MANUTENCAO') return 'manutencao';
  if (estufa.situacao === 'INATIVA') return 'inativa';
  if (estufa.situacao === 'RESERVADA') return 'reservada';
  if (estufa.situacao === 'OCUPADA') return 'ocupada';
  if (estufa.ocupado <= 0) return 'livre';
  return estufa.disponivel <= 0 ? 'ocupada' : 'parcial';
}

/** O espaço aceita nova reserva? Capacidade cheia ou fora de uso, não. */
export function aceitaReserva(estufa: Estufa): boolean {
  return estufa.situacao === 'ATIVA' && estufa.disponivel > 0;
}

/* ===========================================================================
   Consultas
   =========================================================================== */

/** Reservas que ainda valem: nem canceladas, nem de espaços inexistentes. */
export function reservasVigentes(): Reserva[] {
  return reservas.filter((r) => r.status !== 'cancelada' && r.estufaId !== '');
}

/**
 * Reservas vigentes de um espaço que cobrem a data informada.
 *
 * Plural de propósito: com a reserva parcial, várias pessoas dividem a mesma
 * estufa no mesmo período. A versão antiga devolvia só a primeira e escondia
 * as demais da coluna "Reservado por".
 */
export function reservasDoEspaco(estufaId: string, data = hojeISO()): Reserva[] {
  return reservasVigentes()
    .filter((r) => r.estufaId === estufaId && r.data <= data && r.dataFim >= data)
    .sort((a, b) => b.quantidade - a.quantidade);
}

/** Todas as reservas vigentes de um espaço, de hoje em diante. */
export function proximasReservas(estufaId: string, data = hojeISO()): Reserva[] {
  return reservasVigentes()
    .filter((r) => r.estufaId === estufaId && r.dataFim >= data)
    .sort((a, b) => a.data.localeCompare(b.data));
}

/** Próximo código de reserva livre. Só o modo demonstração precisa disto. */
export function proximoIdReserva(): string {
  const maior = reservas.reduce((max, r) => {
    const numero = Number.parseInt(r.id.replace(/\D/g, ''), 10);
    return Number.isNaN(numero) ? max : Math.max(max, numero);
  }, 0);
  return `R${String(maior + 1).padStart(3, '0')}`;
}
