/**
 * O que a pessoa logada pode fazer.
 *
 * O back-end já responde isso em GET /me/contexto: a lista dos projetos dela,
 * as permissões concedidas em cada um e um resumo do que ela alcança no
 * sistema. Este módulo guarda essa resposta e é a única fonte que as telas
 * consultam — antes cada uma decidia pelo booleano `admin` do usuário, o que
 * escondia Reservas e Projetos de quem não administra e deixava o pesquisador
 * sem como escolher o projeto na hora de reservar.
 */

import { getContexto, type Contexto, type ProjetoDoContexto } from '../services/api';

let contexto: Contexto | null = null;

/**
 * Quem depende das permissões (menu, botão de reservar da ficha, lista de
 * projetos do formulário) se inscreve aqui. Antes o contexto era relido
 * depois de criar ou aprovar um projeto, mas ninguém ficava sabendo: o
 * formulário de reserva seguia com a lista antiga até recarregar a página.
 */
const ouvintes = new Set<() => void>();

export function aoMudarContexto(ouvinte: () => void): void {
  ouvintes.add(ouvinte);
}

function avisarMudanca(): void {
  for (const ouvinte of ouvintes) {
    try {
      ouvinte();
    } catch (erro) {
      console.error('[CVGWeb] falha ao reagir a mudança de permissões:', erro);
    }
  }
}

/** Lida logo depois do login e relida sempre que algo pode ter mudado. */
export async function carregarContexto(): Promise<Contexto | null> {
  try {
    contexto = await getContexto();
  } catch {
    // Sem contexto o app continua de pé, só mais restrito: o back-end recusa
    // de qualquer jeito o que a pessoa não pode, então não vale travar a tela.
    contexto = null;
  }
  avisarMudanca();
  return contexto;
}

export function contextoAtual(): Contexto | null {
  return contexto;
}

export function limparContexto(): void {
  contexto = null;
}

/**
 * Relê depois de algo que muda permissões (projeto aprovado, equipe mexida).
 * O contexto antigo continua valendo até a resposta chegar: zerá-lo antes
 * fazia a ficha dizer "não consegui carregar suas permissões" por um instante.
 * Se a leitura falhar, também fica o antigo — melhor do que tirar tudo.
 */
export async function recarregarContexto(): Promise<Contexto | null> {
  try {
    contexto = await getContexto();
  } catch {
    return contexto;
  }
  avisarMudanca();
  return contexto;
}

export function ehAdm(): boolean {
  return contexto?.adm === true;
}

/** Uma das capacidades que o back-end resume em `pode`. */
export function pode(chave: keyof Contexto['pode']): boolean {
  if (!contexto) return false;
  return contexto.adm || contexto.pode[chave] === true;
}

/** Projetos da pessoa, incluindo os que ainda aguardam aprovação. */
export function meusProjetos(): ProjetoDoContexto[] {
  return contexto?.projetos ?? [];
}

/**
 * Projetos em que dá para reservar agora: aprovados, não encerrados e com
 * permissão de criar reserva. É o que alimenta o campo de projeto do modal.
 */
export function projetosParaReservar(): ProjetoDoContexto[] {
  if (!contexto) return [];
  return contexto.projetos.filter(
    (p) =>
      p.situacao === 'APROVADO' &&
      !p.encerrado &&
      (contexto?.adm || p.permissoes.includes('reserva.criar')),
  );
}

/**
 * Por que a pessoa não consegue reservar, em uma frase — ou null quando ela
 * consegue. A tela usa isso para explicar em vez de só desabilitar o botão.
 */
export function motivoParaNaoReservar(): string | null {
  if (!contexto) return 'Não consegui carregar suas permissões. Recarregue a página.';
  if (contexto.adm) return null;
  if (projetosParaReservar().length) return null;

  const meus = contexto.projetos;
  if (!meus.length) {
    return 'Reservar exige estar na equipe de um projeto aprovado. Crie um projeto ou peça à administração para incluir você em um.';
  }
  if (meus.every((p) => p.situacao === 'PENDENTE')) {
    return 'Seu projeto ainda aguarda aprovação da administração. Assim que for aprovado você poderá reservar.';
  }
  if (meus.every((p) => p.situacao === 'RECUSADO')) {
    return 'Sua proposta de projeto foi recusada. Veja o motivo em Projetos e envie uma nova.';
  }
  if (meus.every((p) => p.encerrado)) {
    return 'Seus projetos estão encerrados e não aceitam novas reservas.';
  }
  return 'Você não tem permissão de criar reserva nos seus projetos. Peça à administração.';
}
