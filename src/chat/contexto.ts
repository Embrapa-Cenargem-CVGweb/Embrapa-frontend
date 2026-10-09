/**
 * Ponte entre o estado do sistema e a base de conhecimento do assistente.
 *
 * `base-conhecimento.md` entra no bundle como texto (`?raw`) e os marcadores
 * `{{...}}` são trocados pelo estado real a cada pergunta. É o que faz o `.md`
 * ficar "ligado" no sistema: quem edita o arquivo muda o comportamento do
 * chat; quem reserva um espaço muda a resposta.
 */
import BASE from './base-conhecimento.md?raw';
import { ESTUFAS, garantirEstadoFresco, reservasVigentes, ultimaLeitura } from '../data/estufas';
import { MODO_DEMO } from '../lib/ambiente';
import { dataBR, hojeISO } from '../lib/format';
import { usuarioAtual } from '../views/login';
import type { Estufa, Reserva } from '../types';

const DIA = 86_400_000;

/** Diferença em dias entre duas datas AAAA-MM-DD (b - a). */
function dias(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00`) - Date.parse(`${a}T00:00:00`);
  return Number.isNaN(ms) ? 0 : Math.round(ms / DIA);
}

function plural(n: number, um: string, muitos: string): string {
  return `${n} ${n === 1 ? um : muitos}`;
}

/** "10/04/2026 a 10/07/2026 (91 dias) — em uso, faltam 3 dias" */
function periodo(reserva: Reserva, hoje: string): string {
  const { data, dataFim } = reserva;
  if (!data) return 'período não informado';

  const total = dataFim ? dias(data, dataFim) + 1 : 0;
  const faixa = dataFim
    ? `${dataBR(data)} a ${dataBR(dataFim)} (${plural(total, 'dia', 'dias')})`
    : `a partir de ${dataBR(data)} (sem data de fim)`;

  if (dias(hoje, data) > 0) {
    return `${faixa} — começa em ${plural(dias(hoje, data), 'dia', 'dias')}`;
  }
  if (!dataFim) return `${faixa} — em uso`;

  const restam = dias(hoje, dataFim);
  if (restam > 0) return `${faixa} — em uso, faltam ${plural(restam, 'dia', 'dias')}`;
  if (restam === 0) return `${faixa} — em uso, termina hoje`;
  return `${faixa} — período encerrado há ${plural(-restam, 'dia', 'dias')}`;
}

/** "E03 (Estufa 03)" ou só o código, quando o espaço não existe mais. */
function titulo(id: string, estufa: Estufa | undefined): string {
  return estufa ? `${id} (${estufa.nome})` : id;
}

function ficha(estufa: Estufa | undefined): string {
  if (!estufa) return 'espaço não encontrado no cadastro';
  const partes = [estufa.tipo, estufa.setor ?? '—', estufa.area, plural(estufa.cap, 'bancada', 'bancadas')];
  return partes.filter(Boolean).join(', ');
}

/* ===========================================================================
   Seções geradas
   =========================================================================== */

function resumo(): string {
  const todos = Object.values(ESTUFAS);
  const conta = (s: Estufa['status']): number => todos.filter((e) => e.status === s).length;

  return [
    `- Total de espaços cadastrados: ${todos.length}`,
    `- Livres: ${conta('livre')}`,
    `- Ocupados: ${conta('ocupada')}`,
    `- Reservados: ${conta('reservada')}`,
    `- Em manutenção: ${conta('manutencao')}`,
    `- Reservas vigentes (ativas ou pendentes): ${reservasVigentes().length}`,
  ].join('\n');
}

function ocupacao(hoje: string): string {
  const lista = reservasVigentes()
    .slice()
    .sort((a, b) => a.estufaId.localeCompare(b.estufaId));

  if (!lista.length) return 'Nenhuma reserva vigente no momento.';

  return lista
    .map((r) => {
      const estufa = ESTUFAS[r.estufaId];
      const linhas = [
        `- **${titulo(r.estufaId, estufa)}** — ${ficha(estufa)}`,
        `  - Responsável: ${r.pesquisador || 'não informado'}`,
        `  - Projeto: ${r.projeto || 'não informado'}`,
        `  - Finalidade (o que está sendo cultivado): ${r.finalidade || 'não informada'}`,
        `  - Período: ${periodo(r, hoje)}`,
        `  - Situação da reserva: ${r.status === 'pendente' ? 'pendente (aguardando aprovação do administrador)' : 'ativa'}`,
        `  - Código da reserva: ${r.id}`,
      ];
      if (r.obs) linhas.push(`  - Observações: ${r.obs}`);
      return linhas.join('\n');
    })
    .join('\n');
}

/** Livres agrupados por setor, com área e bancadas para filtrar por capacidade. */
function porStatus(status: Estufa['status'], vazio: string): string {
  const setores = new Map<string, string[]>();

  for (const [id, estufa] of Object.entries(ESTUFAS)) {
    if (estufa.status !== status) continue;
    const setor = estufa.setor ?? 'Sem setor';
    const item = `${id} (${estufa.nome}, ${estufa.tipo}, ${estufa.area}, ${plural(estufa.cap, 'bancada', 'bancadas')})`;
    const atual = setores.get(setor);
    if (atual) atual.push(item);
    else setores.set(setor, [item]);
  }

  if (!setores.size) return vazio;

  return [...setores.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([setor, itens]) => `- **${setor}**: ${itens.join('; ')}`)
    .join('\n');
}

/** "lido do servidor às 16:12" — para o assistente poder dizer de quando é. */
function frescor(): string {
  const momento = ultimaLeitura();
  const hora = momento
    ? new Date(momento).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : '—';

  return MODO_DEMO
    ? `estado em memória às ${hora}; muda a cada reserva feita nesta tela`
    : `lido da API às ${hora}; relido antes de cada pergunta`;
}

function quemEsta(): string {
  const usuario = usuarioAtual();
  if (!usuario) return 'ninguém autenticado';
  return `${usuario.nome} — ${usuario.cargo}${usuario.admin ? ' (administrador, vê a área de administração)' : ' (não é administrador)'}`;
}

/* ===========================================================================
   Prompt
   =========================================================================== */

/**
 * Base de conhecimento com o estado do sistema injetado.
 *
 * Assíncrona de propósito: antes de montar o texto, releva o estado da API se
 * ele já estiver velho. Quem chama sempre recebe o retrato de agora, não o do
 * login.
 */
export async function montarPrompt(): Promise<string> {
  await garantirEstadoFresco();

  const hoje = hojeISO();

  const valores: Record<string, string> = {
    HOJE: dataBR(hoje),
    USUARIO: quemEsta(),
    ORIGEM: MODO_DEMO
      ? 'modo demonstração (dados locais de exemplo, sem back-end)'
      : 'API Laravel do CVGWeb',
    ATUALIZADO: frescor(),
    RESUMO: resumo(),
    OCUPACAO: ocupacao(hoje),
    LIVRES: porStatus('livre', 'Nenhum espaço livre no momento.'),
    MANUTENCAO: porStatus('manutencao', 'Nenhum espaço em manutenção.'),
  };

  return BASE.replace(/\{\{(\w+)\}\}/g, (todo, chave: string) => valores[chave] ?? todo);
}
