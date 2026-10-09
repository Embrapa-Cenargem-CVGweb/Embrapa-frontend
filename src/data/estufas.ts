/**
 * Estado dos espaços e das reservas.
 *
 * `ESTUFAS` e `reservas` são mutados no lugar (nunca reatribuídos), para que
 * quem importou continue vendo a mesma referência.
 *
 * Em modo demonstração os dados vêm de `mock.ts` e as alterações ficam no
 * localStorage. Com `VITE_API_URL` configurada, vêm da API Laravel.
 */
import type { Estufas, Reserva, EstufaStatus } from '../types';
import { dadosMudaram } from '../lib/bus';
import { getCasasVegetacao, getReservas } from '../services/api';
import { MOCK_ESTUFAS, MOCK_RESERVAS } from './mock';
import { hojeISO } from '../lib/format';
import { MODO_DEMO } from '../lib/ambiente';

export const ESTUFAS: Estufas = {};
export const reservas: Reserva[] = [];

/**
 * Código da interface (E01, R001) para o id real do banco. A API precisa do id
 * numérico ao criar ou alterar uma reserva; a interface só conhece o código.
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
  reservas: 'cvgweb:reservas:v2',
  status: 'cvgweb:status:v2',
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

    const status = localStorage.getItem(CHAVES.status);
    if (status) {
      const mapa = JSON.parse(status) as Record<string, EstufaStatus>;
      for (const [id, valor] of Object.entries(mapa)) {
        if (ESTUFAS[id]) ESTUFAS[id].status = valor;
      }
    }
  } catch (erro) {
    console.warn('[CVGWeb] estado local inválido, ignorando:', erro);
  }
}

export function salvarEstado(): void {
  if (!MODO_DEMO) return;
  try {
    const status: Record<string, EstufaStatus> = {};
    for (const [id, estufa] of Object.entries(ESTUFAS)) status[id] = estufa.status;
    localStorage.setItem(CHAVES.reservas, JSON.stringify(reservas));
    localStorage.setItem(CHAVES.status, JSON.stringify(status));
  } catch (erro) {
    console.warn('[CVGWeb] não foi possível salvar o estado:', erro);
  }
}

/* ===========================================================================
   API
   =========================================================================== */

interface CasaApi {
  id: number;
  descricao?: string;
  localizacao?: string;
  area_m2?: number;
  capacidade?: number;
  obs?: string;
  ativa?: boolean;
}

interface ReservaApi {
  id: number;
  casa_vegetacao_id: number;
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

function statusDaCasa(chave: string, ativa: boolean): EstufaStatus {
  if (!ativa) return 'manutencao';
  const hoje = hojeISO();
  const ocupadaHoje = reservas.some(
    (r) => r.estufaId === chave && r.status !== 'cancelada' && r.data === hoje,
  );
  return ocupadaHoje ? 'ocupada' : 'livre';
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

    // Ordena pelo id real para que E01, E02... sigam sempre a mesma ordem,
    // independente de como o backend devolveu.
    const casas: CasaApi[] = (casasResposta.data ?? casasResposta)
      .slice()
      .sort((a: CasaApi, b: CasaApi) => a.id - b.id);

    const chavePorId: Record<number, string> = {};
    casas.forEach((casa, indice) => {
      const chave = `E${String(indice + 1).padStart(2, '0')}`;
      chavePorId[casa.id] = chave;
      ID_REAL_ESPACO[chave] = casa.id;

      ESTUFAS[chave] = {
        nome: casa.descricao ?? chave,
        tipo: 'Casa de vegetação',
        setor: casa.localizacao ?? '—',
        status: statusDaCasa(chave, casa.ativa !== false),
        area: casa.area_m2 ? `${casa.area_m2} m²` : '—',
        cap: casa.capacidade ?? 0,
        icon: 'leaf',
        desc: casa.obs ?? '',
      };
    });

    const lista: ReservaApi[] = reservasResposta.data ?? reservasResposta;
    for (const item of lista) {
      const codigo = `R${String(item.id).padStart(3, '0')}`;
      ID_REAL_RESERVA[codigo] = item.id;

      reservas.push({
        id: codigo,
        estufaId:
          chavePorId[item.casa_vegetacao_id]
          ?? `E${String(item.casa_vegetacao_id).padStart(2, '0')}`,
        data: item.data_inicio?.slice(0, 10) ?? '',
        dataFim: item.data_fim?.slice(0, 10) ?? '',
        projeto: item.projeto?.codigo ?? String(item.projeto_id ?? ''),
        finalidade: item.finalidade ?? '',
        obs: item.obs ?? '',
        pesquisador: item.funcionario?.nome ?? '',
        status: statusDaReserva(item.status),
      });
    }

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
   Consultas
   =========================================================================== */

/** Reservas que ainda valem: nem canceladas, nem de espaços inexistentes. */
export function reservasVigentes(): Reserva[] {
  return reservas.filter((r) => r.status !== 'cancelada');
}

/** Reserva vigente de um espaço, se houver. */
export function reservaDoEspaco(estufaId: string): Reserva | undefined {
  return reservasVigentes().find((r) => r.estufaId === estufaId);
}

/** Próximo código de reserva livre, considerando as já canceladas. */
export function proximoIdReserva(): string {
  const maior = reservas.reduce((max, r) => {
    const numero = Number.parseInt(r.id.replace(/\D/g, ''), 10);
    return Number.isNaN(numero) ? max : Math.max(max, numero);
  }, 0);
  return `R${String(maior + 1).padStart(3, '0')}`;
}
