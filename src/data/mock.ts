/**
 * Dados MOCK — Embrapa Cenargen (50 estufas)
 * Usado quando VITE_USE_MOCK=true ou quando a API não responde,
 * para que o sistema possa ser apresentado sem backend.
 */
import type { Estufa, Reserva } from '../types';

export const MOCK_ESTUFAS: Record<string, Estufa> = {
  E01: { nome: 'Estufa 01', tipo: 'Casa de vegetação', setor: 'Setor Norte', status: 'livre', area: '204 m²', cap: 4, vasos: { c3: 226, c5: 81, c10: 20 }, icon: 'leaf', desc: 'Estrutura em alumínio com cobertura de policarbonato, bancadas e sistema de nebulização.' },
  E02: { nome: 'Estufa 02', tipo: 'Estufa climatizada', setor: 'Setor Norte', status: 'livre', area: '133 m²', cap: 6, vasos: { c3: 148, c5: 53, c10: 13 }, icon: 'sprout', desc: 'Espaço para experimentos de pequeno porte com controle de luz e ventilação.' },
  E03: { nome: 'Estufa 03', tipo: 'Telado agrícola', setor: 'Setor Norte', status: 'ocupada', area: '139 m²', cap: 8, vasos: { c3: 154, c5: 55, c10: 13 }, icon: 'fence', desc: 'Câmara com controle de temperatura, umidade e fotoperíodo para ensaios de precisão.' },
  E04: { nome: 'Estufa 04', tipo: 'Casa de vegetação', setor: 'Setor Norte', status: 'livre', area: '113 m²', cap: 10, vasos: { c3: 125, c5: 45, c10: 11 }, icon: 'leaf', desc: 'Casa de vegetação para multiplicação e aclimatação de mudas e plântulas.' },
  E05: { nome: 'Estufa 05', tipo: 'Estufa climatizada', setor: 'Setor Norte', status: 'reservada', area: '113 m²', cap: 12, vasos: { c3: 125, c5: 45, c10: 11 }, icon: 'sprout', desc: 'Ambiente protegido para estudos de melhoramento e fitossanidade vegetal.' },
  E06: { nome: 'Estufa 06', tipo: 'Telado agrícola', setor: 'Setor Norte', status: 'livre', area: '96 m²', cap: 14, vasos: { c3: 106, c5: 38, c10: 9 }, icon: 'fence', desc: 'Casa de vegetação climatizada com irrigação automatizada para condições controladas.' },
  E07: { nome: 'Estufa 07', tipo: 'Casa de vegetação', setor: 'Setor Norte', status: 'livre', area: '96 m²', cap: 4, vasos: { c3: 106, c5: 38, c10: 9 }, icon: 'leaf', desc: 'Estrutura em alumínio com cobertura de policarbonato, bancadas e sistema de nebulização.' },
  E08: { nome: 'Estufa 08', tipo: 'Estufa climatizada', setor: 'Setor Norte', status: 'manutencao', area: '180 m²', cap: 6, vasos: { c3: 200, c5: 72, c10: 18 }, icon: 'sprout', desc: 'Espaço para experimentos de pequeno porte com controle de luz e ventilação.' },
  E09: { nome: 'Estufa 09', tipo: 'Telado agrícola', setor: 'Setor Norte', status: 'livre', area: '125 m²', cap: 8, vasos: { c3: 138, c5: 50, c10: 12 }, icon: 'fence', desc: 'Câmara com controle de temperatura, umidade e fotoperíodo para ensaios de precisão.' },
  E10: { nome: 'Estufa 10', tipo: 'Casa de vegetação', setor: 'Setor Norte', status: 'livre', area: '121 m²', cap: 10, vasos: { c3: 134, c5: 48, c10: 12 }, icon: 'leaf', desc: 'Casa de vegetação para multiplicação e aclimatação de mudas e plântulas.' },
  E11: { nome: 'Estufa 11', tipo: 'Estufa climatizada', setor: 'Setor Norte', status: 'ocupada', area: '123 m²', cap: 12, vasos: { c3: 136, c5: 49, c10: 12 }, icon: 'sprout', desc: 'Ambiente protegido para estudos de melhoramento e fitossanidade vegetal.' },
  E12: { nome: 'Estufa 12', tipo: 'Telado agrícola', setor: 'Setor Norte', status: 'livre', area: '134 m²', cap: 14, vasos: { c3: 149, c5: 53, c10: 13 }, icon: 'fence', desc: 'Casa de vegetação climatizada com irrigação automatizada para condições controladas.' },
  E13: { nome: 'Estufa 13', tipo: 'Casa de vegetação', setor: 'Setor Norte', status: 'reservada', area: '106 m²', cap: 4, vasos: { c3: 117, c5: 42, c10: 10 }, icon: 'leaf', desc: 'Estrutura em alumínio com cobertura de policarbonato, bancadas e sistema de nebulização.' },
  E14: { nome: 'Estufa 14', tipo: 'Estufa climatizada', setor: 'Setor Norte', status: 'livre', area: '106 m²', cap: 6, vasos: { c3: 117, c5: 42, c10: 10 }, icon: 'sprout', desc: 'Espaço para experimentos de pequeno porte com controle de luz e ventilação.' },
  E15: { nome: 'Estufa 15', tipo: 'Telado agrícola', setor: 'Setor Norte', status: 'livre', area: '103 m²', cap: 8, vasos: { c3: 114, c5: 41, c10: 10 }, icon: 'fence', desc: 'Câmara com controle de temperatura, umidade e fotoperíodo para ensaios de precisão.' },
  E16: { nome: 'Estufa 16', tipo: 'Casa de vegetação', setor: 'Setor Norte', status: 'manutencao', area: '103 m²', cap: 10, vasos: { c3: 114, c5: 41, c10: 10 }, icon: 'leaf', desc: 'Casa de vegetação para multiplicação e aclimatação de mudas e plântulas.' },
  E17: { nome: 'Estufa 17', tipo: 'Estufa climatizada', setor: 'Setor Leste', status: 'livre', area: '122 m²', cap: 12, vasos: { c3: 135, c5: 48, c10: 12 }, icon: 'sprout', desc: 'Ambiente protegido para estudos de melhoramento e fitossanidade vegetal.' },
  E18: { nome: 'Estufa 18', tipo: 'Telado agrícola', setor: 'Setor Leste', status: 'livre', area: '122 m²', cap: 14, vasos: { c3: 135, c5: 48, c10: 12 }, icon: 'fence', desc: 'Casa de vegetação climatizada com irrigação automatizada para condições controladas.' },
  E19: { nome: 'Estufa 19', tipo: 'Casa de vegetação', setor: 'Setor Leste', status: 'ocupada', area: '124 m²', cap: 4, vasos: { c3: 138, c5: 49, c10: 12 }, icon: 'leaf', desc: 'Estrutura em alumínio com cobertura de policarbonato, bancadas e sistema de nebulização.' },
  E20: { nome: 'Estufa 20', tipo: 'Estufa climatizada', setor: 'Setor Leste', status: 'livre', area: '124 m²', cap: 6, vasos: { c3: 138, c5: 49, c10: 12 }, icon: 'sprout', desc: 'Espaço para experimentos de pequeno porte com controle de luz e ventilação.' },
  E21: { nome: 'Estufa 21', tipo: 'Telado agrícola', setor: 'Setor Leste', status: 'reservada', area: '58 m²', cap: 8, vasos: { c3: 64, c5: 23, c10: 5 }, icon: 'fence', desc: 'Câmara com controle de temperatura, umidade e fotoperíodo para ensaios de precisão.' },
  E22: { nome: 'Estufa 22', tipo: 'Casa de vegetação', setor: 'Setor Central', status: 'livre', area: '122 m²', cap: 10, vasos: { c3: 135, c5: 48, c10: 12 }, icon: 'leaf', desc: 'Casa de vegetação para multiplicação e aclimatação de mudas e plântulas.' },
  E23: { nome: 'Estufa 23', tipo: 'Estufa climatizada', setor: 'Setor Central', status: 'livre', area: '122 m²', cap: 12, vasos: { c3: 135, c5: 48, c10: 12 }, icon: 'sprout', desc: 'Ambiente protegido para estudos de melhoramento e fitossanidade vegetal.' },
  E24: { nome: 'Estufa 24', tipo: 'Telado agrícola', setor: 'Setor Central', status: 'manutencao', area: '122 m²', cap: 14, vasos: { c3: 135, c5: 48, c10: 12 }, icon: 'fence', desc: 'Casa de vegetação climatizada com irrigação automatizada para condições controladas.' },
  E25: { nome: 'Estufa 25', tipo: 'Casa de vegetação', setor: 'Setor Central', status: 'livre', area: '122 m²', cap: 4, vasos: { c3: 135, c5: 48, c10: 12 }, icon: 'leaf', desc: 'Estrutura em alumínio com cobertura de policarbonato, bancadas e sistema de nebulização.' },
  E26: { nome: 'Estufa 26', tipo: 'Estufa climatizada', setor: 'Setor Central', status: 'livre', area: '122 m²', cap: 6, vasos: { c3: 135, c5: 48, c10: 12 }, icon: 'sprout', desc: 'Espaço para experimentos de pequeno porte com controle de luz e ventilação.' },
  E27: { nome: 'Estufa 27', tipo: 'Telado agrícola', setor: 'Setor Central', status: 'ocupada', area: '122 m²', cap: 8, vasos: { c3: 135, c5: 48, c10: 12 }, icon: 'fence', desc: 'Câmara com controle de temperatura, umidade e fotoperíodo para ensaios de precisão.' },
  E28: { nome: 'Estufa 28', tipo: 'Casa de vegetação', setor: 'Setor Central', status: 'livre', area: '122 m²', cap: 10, vasos: { c3: 135, c5: 48, c10: 12 }, icon: 'leaf', desc: 'Casa de vegetação para multiplicação e aclimatação de mudas e plântulas.' },
  E29: { nome: 'Estufa 29', tipo: 'Estufa climatizada', setor: 'Setor Central', status: 'reservada', area: '122 m²', cap: 12, vasos: { c3: 135, c5: 48, c10: 12 }, icon: 'sprout', desc: 'Ambiente protegido para estudos de melhoramento e fitossanidade vegetal.' },
  E30: { nome: 'Estufa 30', tipo: 'Telado agrícola', setor: 'Setor Central', status: 'livre', area: '196 m²', cap: 14, vasos: { c3: 218, c5: 78, c10: 19 }, icon: 'fence', desc: 'Casa de vegetação climatizada com irrigação automatizada para condições controladas.' },
  E31: { nome: 'Estufa 31', tipo: 'Casa de vegetação', setor: 'Setor Central', status: 'livre', area: '196 m²', cap: 4, vasos: { c3: 218, c5: 78, c10: 19 }, icon: 'leaf', desc: 'Estrutura em alumínio com cobertura de policarbonato, bancadas e sistema de nebulização.' },
  E32: { nome: 'Estufa 32', tipo: 'Estufa climatizada', setor: 'Setor Central', status: 'livre', area: '196 m²', cap: 6, vasos: { c3: 218, c5: 78, c10: 19 }, icon: 'sprout', desc: 'Espaço para experimentos de pequeno porte com controle de luz e ventilação.' },
  E33: { nome: 'Estufa 33', tipo: 'Telado agrícola', setor: 'Setor Central', status: 'livre', area: '196 m²', cap: 8, vasos: { c3: 218, c5: 78, c10: 19 }, icon: 'fence', desc: 'Câmara com controle de temperatura, umidade e fotoperíodo para ensaios de precisão.' },
  E34: { nome: 'Estufa 34', tipo: 'Casa de vegetação', setor: 'Setor Central', status: 'livre', area: '135 m²', cap: 10, vasos: { c3: 149, c5: 53, c10: 13 }, icon: 'leaf', desc: 'Casa de vegetação para multiplicação e aclimatação de mudas e plântulas.' },
  E35: { nome: 'Estufa 35', tipo: 'Estufa climatizada', setor: 'Setor Central', status: 'ocupada', area: '123 m²', cap: 12, vasos: { c3: 136, c5: 49, c10: 12 }, icon: 'sprout', desc: 'Ambiente protegido para estudos de melhoramento e fitossanidade vegetal.' },
  E36: { nome: 'Estufa 36', tipo: 'Telado agrícola', setor: 'Setor Sul', status: 'livre', area: '222 m²', cap: 14, vasos: { c3: 246, c5: 88, c10: 22 }, icon: 'fence', desc: 'Casa de vegetação climatizada com irrigação automatizada para condições controladas.' },
  E37: { nome: 'Estufa 37', tipo: 'Casa de vegetação', setor: 'Setor Sul', status: 'livre', area: '222 m²', cap: 4, vasos: { c3: 246, c5: 88, c10: 22 }, icon: 'leaf', desc: 'Estrutura em alumínio com cobertura de policarbonato, bancadas e sistema de nebulização.' },
  E38: { nome: 'Estufa 38', tipo: 'Estufa climatizada', setor: 'Setor Sul', status: 'manutencao', area: '222 m²', cap: 6, vasos: { c3: 246, c5: 88, c10: 22 }, icon: 'sprout', desc: 'Espaço para experimentos de pequeno porte com controle de luz e ventilação.' },
  E39: { nome: 'Estufa 39', tipo: 'Telado agrícola', setor: 'Setor Sul', status: 'livre', area: '222 m²', cap: 8, vasos: { c3: 246, c5: 88, c10: 22 }, icon: 'fence', desc: 'Câmara com controle de temperatura, umidade e fotoperíodo para ensaios de precisão.' },
  E40: { nome: 'Estufa 40', tipo: 'Casa de vegetação', setor: 'Setor Sul', status: 'livre', area: '231 m²', cap: 10, vasos: { c3: 256, c5: 92, c10: 23 }, icon: 'leaf', desc: 'Casa de vegetação para multiplicação e aclimatação de mudas e plântulas.' },
  E41: { nome: 'Estufa 41', tipo: 'Estufa climatizada', setor: 'Setor Sul', status: 'ocupada', area: '119 m²', cap: 12, vasos: { c3: 132, c5: 47, c10: 11 }, icon: 'sprout', desc: 'Ambiente protegido para estudos de melhoramento e fitossanidade vegetal.' },
  E42: { nome: 'Estufa 42', tipo: 'Telado agrícola', setor: 'Setor Sul', status: 'livre', area: '123 m²', cap: 14, vasos: { c3: 137, c5: 49, c10: 12 }, icon: 'fence', desc: 'Casa de vegetação climatizada com irrigação automatizada para condições controladas.' },
  E43: { nome: 'Estufa 43', tipo: 'Casa de vegetação', setor: 'Setor Sul', status: 'livre', area: '122 m²', cap: 4, vasos: { c3: 136, c5: 48, c10: 12 }, icon: 'leaf', desc: 'Estrutura em alumínio com cobertura de policarbonato, bancadas e sistema de nebulização.' },
  E44: { nome: 'Estufa 44', tipo: 'Estufa climatizada', setor: 'Setor Sul', status: 'livre', area: '151 m²', cap: 6, vasos: { c3: 167, c5: 60, c10: 15 }, icon: 'sprout', desc: 'Espaço para experimentos de pequeno porte com controle de luz e ventilação.' },
  E45: { nome: 'Estufa 45', tipo: 'Telado agrícola', setor: 'Setor Sul', status: 'reservada', area: '121 m²', cap: 8, vasos: { c3: 134, c5: 48, c10: 12 }, icon: 'fence', desc: 'Câmara com controle de temperatura, umidade e fotoperíodo para ensaios de precisão.' },
  E46: { nome: 'Estufa 46', tipo: 'Casa de vegetação', setor: 'Setor Sul', status: 'livre', area: '121 m²', cap: 10, vasos: { c3: 134, c5: 48, c10: 12 }, icon: 'leaf', desc: 'Casa de vegetação para multiplicação e aclimatação de mudas e plântulas.' },
  E47: { nome: 'Estufa 47', tipo: 'Estufa climatizada', setor: 'Setor Sul', status: 'livre', area: '121 m²', cap: 12, vasos: { c3: 134, c5: 48, c10: 12 }, icon: 'sprout', desc: 'Ambiente protegido para estudos de melhoramento e fitossanidade vegetal.' },
  E48: { nome: 'Estufa 48', tipo: 'Telado agrícola', setor: 'Setor Sul', status: 'manutencao', area: '123 m²', cap: 14, vasos: { c3: 136, c5: 49, c10: 12 }, icon: 'fence', desc: 'Casa de vegetação climatizada com irrigação automatizada para condições controladas.' },
  E49: { nome: 'Estufa 49', tipo: 'Casa de vegetação', setor: 'Setor Sul', status: 'livre', area: '78 m²', cap: 4, vasos: { c3: 86, c5: 31, c10: 7 }, icon: 'leaf', desc: 'Estrutura em alumínio com cobertura de policarbonato, bancadas e sistema de nebulização.' },
  E50: { nome: 'Estufa 50', tipo: 'Estufa climatizada', setor: 'Setor Sul', status: 'livre', area: '399 m²', cap: 6, vasos: { c3: 443, c5: 159, c10: 39 }, icon: 'sprout', desc: 'Espaço para experimentos de pequeno porte com controle de luz e ventilação.' },
};

/* ===========================================================================
   Reservas de exemplo

   Os períodos são relativos ao dia em que o sistema é aberto, não datas fixas:
   assim a demonstração nunca aparece com tudo vencido. Cobrem todos os espaços
   marcados como ocupados ou reservados acima, para que a coluna "Reservado por"
   da administração tenha o que mostrar.
   =========================================================================== */

/** AAAA-MM-DD a partir de hoje, deslocado em dias. */
function emDias(deslocamento: number): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + deslocamento);
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

interface Semente {
  estufaId: string;
  /** Dias a partir de hoje: negativo já começou, positivo começa depois. */
  de: number;
  ate: number;
  projeto: string;
  finalidade: string;
  pesquisador: string;
  status?: Reserva['status'];
  obs?: string;
}

/** Em uso agora (espaços com status "ocupada") e por vir (status "reservada"). */
const SEMENTES: Semente[] = [
  {
    estufaId: 'E03', de: -42, ate: 48,
    projeto: 'CRISPR-Soja: resistência a nematódeos',
    finalidade: 'Ensaio de resistência em linhagens editadas de soja',
    pesquisador: 'Rafael Lima',
  },
  {
    estufaId: 'E11', de: -18, ate: 72,
    projeto: 'Melhoramento de milho tropical',
    finalidade: 'Avaliação de tolerância a estresse hídrico em milho',
    pesquisador: 'Rafael Lima',
  },
  {
    estufaId: 'E19', de: -7, ate: 83,
    projeto: 'Banco ativo de germoplasma de mandioca',
    finalidade: 'Aclimatação de mudas de mandioca vindas de cultura de tecidos',
    pesquisador: 'Marcos Teixeira',
  },
  {
    estufaId: 'E27', de: -60, ate: 30,
    projeto: 'Fitossanidade do algodoeiro',
    finalidade: 'Inoculação controlada de ramulose em algodão',
    pesquisador: 'Juliana Prado',
    obs: 'Acesso restrito: material inoculado.',
  },
  {
    estufaId: 'E35', de: -3, ate: 25,
    projeto: 'Biofortificação em feijão',
    finalidade: 'Multiplicação de sementes da geração F3 de feijão-carioca',
    pesquisador: 'Ana Oliveira',
  },
  {
    estufaId: 'E41', de: -29, ate: 61,
    projeto: 'Conservação de espécies nativas do Cerrado',
    finalidade: 'Germinação e crescimento inicial de baru e pequi',
    pesquisador: 'Carlos Menezes',
  },
  {
    estufaId: 'E05', de: 9, ate: 99,
    projeto: 'Biofortificação em feijão',
    finalidade: 'Multiplicação de sementes da geração F4 de feijão-preto',
    pesquisador: 'Ana Oliveira',
    status: 'pendente',
  },
  {
    estufaId: 'E13', de: 15, ate: 60,
    projeto: 'Pré-melhoramento de arroz de terras altas',
    finalidade: 'Cruzamentos dirigidos entre acessos de arroz',
    pesquisador: 'Beatriz Nogueira',
  },
  {
    estufaId: 'E21', de: 5, ate: 35,
    projeto: 'Quarentena vegetal de material importado',
    finalidade: 'Observação quarentenária de acessos de trigo',
    pesquisador: 'Paulo Sérgio Alves',
    status: 'pendente',
    obs: 'Depende da liberação da quarentena.',
  },
  {
    estufaId: 'E29', de: 21, ate: 111,
    projeto: 'Interação planta-microrganismo em cana',
    finalidade: 'Ensaio de inoculação de bactérias fixadoras em cana-de-açúcar',
    pesquisador: 'Helena Vasques',
  },
  {
    estufaId: 'E45', de: 12, ate: 42,
    projeto: 'Fenotipagem de tomate para pós-colheita',
    finalidade: 'Produção de frutos para avaliação de firmeza e vida de prateleira',
    pesquisador: 'Marcos Teixeira',
  },
];

export const MOCK_RESERVAS: Reserva[] = SEMENTES.map((s, indice) => ({
  id: `R${String(indice + 1).padStart(3, '0')}`,
  estufaId: s.estufaId,
  data: emDias(s.de),
  dataFim: emDias(s.ate),
  projeto: s.projeto,
  finalidade: s.finalidade,
  pesquisador: s.pesquisador,
  obs: s.obs,
  status: s.status ?? 'ativa',
}));
