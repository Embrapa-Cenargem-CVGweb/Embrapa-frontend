/**
 * Tela de falha: o que a pessoa vê quando o sistema não consegue continuar.
 *
 * Antes, quando a API não respondia, o mapa simplesmente subia vazio — sem
 * marcador, sem erro, sem explicação. Quem abria achava que o parque estava
 * sem cadastro, e a administração parecia ter perdido os dados.
 *
 * Cada caso tem a sua frase e o seu próximo passo, porque são problemas
 * diferentes: API fora do ar se resolve subindo o container; 403 é
 * configuração de permissão; 500 é defeito no servidor e pede o log. O código
 * HTTP aparece na tela de propósito — é o que faz sentido pedir a quem for
 * ajudar, ou colocar num chamado.
 *
 * 401 e 419 NÃO vêm para cá: token morto devolve a pessoa para a entrada, que
 * é onde ela resolve o problema. Isso é tratado em `app.ts`.
 */
import { el, setText, show } from '../lib/dom';

interface Caso {
  /** O que aparece acima do título: o código, ou uma palavra quando não há um. */
  codigo: string;
  icone: string;
  titulo: string;
  descricao: string;
  /** Próximo passo concreto. Vazio quando não há um que sirva. */
  dica: string;
  /** Mostra o botão de tentar de novo: só quando repetir pode dar certo. */
  repetir: boolean;
}

/**
 * `status` 0 significa que a requisição não chegou a ter resposta — API
 * desligada, container fora do ar, rede caída. É o caso mais comum em
 * desenvolvimento e o que mais confundia.
 */
function casoDe(status: number): Caso {
  if (status === 0) {
    return {
      codigo: 'sem resposta',
      icone: 'ban',
      titulo: 'A API não respondeu',
      descricao:
        'O sistema não conseguiu falar com o servidor. Nada foi perdido: '
        + 'os dados estão no banco e aparecem assim que a API voltar.',
      dica: 'Confira a sua conexão e tente de novo. Se continuar, avise a administração.',
      repetir: true,
    };
  }

  if (status === 403) {
    return {
      codigo: '403',
      icone: 'shield-check',
      titulo: 'Sem permissão para isto',
      descricao:
        'O seu acesso não alcança esta parte do sistema. Permissões são '
        + 'concedidas por projeto, pela administração.',
      dica: 'Peça à administração a permissão no projeto em que você precisa trabalhar.',
      repetir: false,
    };
  }

  if (status === 404) {
    return {
      codigo: '404',
      icone: 'circle-question-mark',
      titulo: 'Esse registro não existe mais',
      descricao:
        'O que você tentou abrir não está no banco. Pode ter sido excluído '
        + 'por outra pessoa enquanto a tela estava aberta.',
      dica: 'Recarregue para ver a lista como ela está agora.',
      repetir: true,
    };
  }

  if (status === 429) {
    return {
      codigo: '429',
      icone: 'clock',
      titulo: 'Muitas tentativas em pouco tempo',
      descricao: 'O servidor pediu uma pausa antes de aceitar novas requisições.',
      dica: 'Espere um minuto e tente de novo.',
      repetir: true,
    };
  }

  if (status === 503) {
    return {
      codigo: '503',
      icone: 'wrench',
      titulo: 'Sistema em manutenção',
      descricao: 'A API está fora do ar de propósito, para manutenção.',
      dica: 'Tente de novo em alguns minutos.',
      repetir: true,
    };
  }

  if (status >= 500) {
    return {
      codigo: String(status),
      icone: 'circle-x',
      titulo: 'Erro no servidor',
      descricao:
        'A API recebeu o pedido e falhou ao responder. O problema é do lado '
        + 'do servidor, não do que você fez.',
      dica: 'Se continuar, avise a administração informando o código acima.',
      repetir: true,
    };
  }

  return {
    codigo: String(status),
    icone: 'circle-x',
    titulo: 'Não foi possível continuar',
    descricao: 'A API recusou o pedido e a tela não tem como seguir sem esses dados.',
    dica: '',
    repetir: true,
  };
}

type AoRepetir = () => void;

let aoRepetirOuvinte: AoRepetir | null = null;

/** A casca da aplicação registra aqui o que o botão "Tentar de novo" refaz. */
export function aoRepetir(ouvinte: AoRepetir): void {
  aoRepetirOuvinte = ouvinte;
}

export function falhaVisivel(): boolean {
  return el('tela-falha')?.hidden === false;
}

/**
 * Mostra a tela.
 *
 * `detalhe` é a frase que a API devolveu, quando houver: ela fica abaixo da
 * explicação, porque costuma ser mais específica do que qualquer texto nosso
 * ("a capacidade já está reservada", "projeto encerrado").
 */
function traduzirDetalhe(detalhe?: string): string | undefined {
  if (!detalhe) return undefined;
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(detalhe)) {
    return 'Sem conexão com o servidor.';
  }
  if (/too many attempts/i.test(detalhe)) return 'Muitas tentativas. Espere um minuto.';
  return detalhe;
}

export function mostrarFalha(status: number, detalhe?: string): void {
  const caso = casoDe(status);

  setText('falha-codigo', caso.codigo);
  setText('falha-titulo', caso.titulo);
  setText('falha-desc', caso.descricao);

  const marca = el('falha-icone');
  if (marca) marca.setAttribute('href', `#i-${caso.icone}`);

  const dica = el('falha-dica');
  show(dica, Boolean(caso.dica));
  if (caso.dica) setText('falha-dica-texto', caso.dica);

  // Mensagem do navegador em inglês (Failed to fetch, NetworkError...)
  // não diz nada a quem usa: vira a explicação em português.
  const extra = traduzirDetalhe(detalhe?.trim());
  show(el('falha-detalhe'), Boolean(extra));
  if (extra) setText('falha-detalhe-texto', extra);

  show(el('falha-repetir'), caso.repetir);
  show(el('tela-falha'), true);

  el<HTMLButtonElement>(caso.repetir ? 'falha-repetir' : 'falha-sair')?.focus();
}

export function esconderFalha(): void {
  show(el('tela-falha'), false);
}

/** Botão "Tentar de novo": esconde a tela e refaz o que falhou. */
export function repetirDepoisDaFalha(): void {
  esconderFalha();
  aoRepetirOuvinte?.();
}

/** Código HTTP de um erro, quando ele veio da API. 0 = não houve resposta. */
export function statusDoErro(erro: unknown): number {
  if (erro && typeof erro === 'object' && 'status' in erro) {
    const status = (erro as { status: unknown }).status;
    if (typeof status === 'number') return status;
  }

  return 0;
}
