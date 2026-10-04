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
import { getCasasVegetacao, getReservas } from '../services/api';
import { MOCK_ESTUFAS, MOCK_RESERVAS } from './mock';
import { hojeISO } from '../lib/format';

export const ESTUFAS: Estufas = {};
export const reservas: Reserva[] = [];

/**
 * Modo demonstração: dados locais em vez da API. Liga com VITE_USE_MOCK=true
 * ou automaticamente quando VITE_API_URL não está definida.
 */
const USE_MOCK =
  String(import.meta.env.VITE_USE_MOCK) === 'true' || !import.meta.env.VITE_API_URL;

const CHAVES = {
  reservas: 'cvgweb:reservas',
  status: 'cvgweb:status',
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
  if (!USE_MOCK) return;
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
  quantidade?: number;
  projeto?: { codigo?: string };
  projeto_id?: number | string;
  status?: Reserva['status'];
}

function statusDaCasa(chave: string, ativa: boolean): EstufaStatus {
  if (!ativa) return 'manutencao';
  const hoje = hojeISO();
  const ocupadaHoje = reservas.some(
    (r) => r.estufaId === chave && r.status !== 'cancelada' && r.data === hoje,
  );
  return ocupadaHoje ? 'ocupada' : 'livre';
}

export async function carregarEstado(): Promise<void> {
  if (USE_MOCK) {
    console.info('[CVGWeb] modo demonstração: dados locais, sem API.');
    carregarMock();
    return;
  }

  try {
    const [casasResposta, reservasResposta] = await Promise.all([
      getCasasVegetacao(),
      getReservas(),
    ]);

    for (const chave of Object.keys(ESTUFAS)) delete ESTUFAS[chave];
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
      reservas.push({
        id: `R${String(item.id).padStart(3, '0')}`,
        estufaId:
          chavePorId[item.casa_vegetacao_id]
          ?? `E${String(item.casa_vegetacao_id).padStart(2, '0')}`,
        data: item.data_inicio?.slice(0, 10) ?? '',
        qtd: item.quantidade ?? 0,
        projeto: item.projeto?.codigo ?? String(item.projeto_id ?? ''),
        status: item.status ?? 'ativa',
      });
    }
  } catch (erro) {
    console.error('[CVGWeb] falha ao carregar da API; usando dados locais:', erro);
    carregarMock();
  }
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
