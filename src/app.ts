/**
 * Casca da aplicação: navegação, menu da conta, tema e ligação das ações.
 *
 * Todo clique entra por um único listener delegado (lib/actions). Nenhuma função
 * é publicada em `window` e não existe `onclick` no HTML.
 */
import { carregarEstado } from './data/estufas';
import { aoPerderSessao } from './services/api';
import { iniciarAcoes, registrarAcoes } from './lib/actions';
import { alternarVisibilidadeSenha } from './lib/senha';
import {
  abrirEsqueci,
  alternarSenhaPronta,
  iniciarAcesso,
  irParaEntrada,
  voltarParaEntrada,
} from './views/acesso';
import { aoMudar } from './lib/bus';
import { debounce, el, qsa, setText, show } from './lib/dom';
import { abrirModal, aoFecharModal, fecharTodosModais, iniciarModais } from './lib/modal';
import { aviso } from './lib/toast';
import type { Usuario } from './types';

import {
  abrirEditarEspaco,
  abrirEditarUsuario,
  buscarEstufaNoFormulario,
  escolherEstufa,
  navegarSugestoesDeEspaco,
  abrirNovoUsuario,
  abrirPainelMetricas,
  alterarSituacaoEspaco,
  alternarAcesso,
  aprovarReserva,
  buscarEspacos,
  buscarReservas,
  buscarUsuarios,
  cancelarReserva,
  confirmarEdicaoUsuario,
  confirmarEspaco,
  confirmarNovoUsuario,
  confirmarPassagemDeLideranca,
  filtrarReservas,
  filtrarUsuarios,
  irPara,
  limparBusca,
  mostrarReservas,
  mostrarUsuarios,
  reenviarConviteDoUsuario,
  renderizarAdmin,
  type FiltroUsuario,
} from './views/admin';
import {
  alternarChat,
  chatSoNoMapa,
  fecharChat,
  iniciarChat,
  limparConversa,
  mostrarChat,
  sugerir,
} from './views/chat';
import { preCarregarHistorico, renderizarHistorico } from './views/auditoria';
import { abrirAvisos, desligarAvisos, irParaAviso, ligarAvisos } from './views/avisos';
import {
  abrirPermissoesDeUsuarios,
  mostrarBotaoDePermissoes,
  salvarPermissoesDoProjeto,
  salvarPermissoesDoSistema,
} from './views/permissoes';
import {
  abrirConvidar,
  abrirConvites,
  desistirDoConvite,
  enviarConvites,
  pintarContadorDeConvites,
  responderConvite,
  trocarAba,
} from './views/convites';
import {
  aoRepetir,
  esconderFalha,
  mostrarFalha,
  repetirDepoisDaFalha,
  statusDoErro,
} from './views/falha';
import {
  definirFiltroAuditoria,
  limparFiltrosAuditoria,
  paginarAuditoria,
} from './views/auditoria';
import {
  abrirEditarProjeto,
  abrirEquipe,
  abrirFichaDoProjeto,
  abrirNovoProjeto,
  decidirProjeto,
  alterarPapelMembro,
  buscarProjetos,
  confirmarProjeto,
  incluirMembro,
  limparBuscaDeProjetos,
  carregarProjetos,
  filtrarProjetos,
  mostrarProjetos,
  pedirExclusaoProjeto,
  recusarProjetoAberto,
  removerMembroDaEquipe,
  voltarParaProjetos,
} from './views/projetos';
import {
  entrar,
  iniciarAutenticacao,
  ligarAutenticacao,
  sair,
  usuarioAtual,
} from './views/login';
import {
  abrirPainel,
  ajustarZoom,
  alternarPopover,
  alternarProximas,
  centralizarMapa,
  escolherResultado,
  fecharPainel,
  iniciarMapa,
  renderizarMarcadores,
  sincronizarMarcadores,
} from './views/mapa';
import {
  abrirEditarReserva,
  abrirModalReservar,
  ajustarFimDaEdicao,
  ajustarFimDoPeriodo,
  cancelarPreenchimentoDaReserva,
  cancelarReservaAberta,
  confirmarEdicaoReserva,
  confirmarReserva,
  consultarDisponibilidade,
  consultarDisponibilidadeDaEdicao,
  editarReservaAberta,
  escolherUnidade,
  excluirReservaAberta,
  guardarRascunhoDaReserva,
  verReserva,
} from './views/reservas';
import { acoesDoCalendario, mostrarCalendario } from './views/calendario';
import { aoNavegar, type Secao } from './lib/navegacao';
import { carregarContexto, limparContexto, pode } from './data/contexto';

/**
 * Quem enxerga cada seção.
 *
 * Mapa, Reservas e Projetos são de todo mundo: o back-end já devolve só o que
 * é da pessoa (as reservas dos projetos dela, os projetos em que ela está), e
 * sem essas telas o pesquisador não tem como escolher o projeto ao reservar
 * nem acompanhar o que pediu. As outras três dependem de permissão concedida
 * em algum projeto — ou de ser a administração.
 */
function podeVerSecao(secao: Secao): boolean {
  if (usuarioAtual()?.admin) return true;

  switch (secao) {
    case 'usuarios':
      return pode('cadastrar_funcionario');
    case 'admin':
      return pode('configurar_casa');
    case 'historico':
      return pode('ver_auditoria');
    default:
      return true;
  }
}

/** Liga os itens do menu ao que a pessoa realmente alcança. */
function aplicarPermissoesNoMenu(): void {
  show(el('nav-calendario'), true);
  show(el('nav-reservas'), true);
  show(el('nav-projetos'), true);
  show(el('nav-usuarios'), podeVerSecao('usuarios'));
  show(el('nav-admin'), podeVerSecao('admin'));
  show(el('nav-historico'), podeVerSecao('historico'));
}

/* ===========================================================================
   Navegação entre views
   =========================================================================== */

function mostrarSecao(secao: Secao): void {
  if (!podeVerSecao(secao)) {
    aviso('Você não tem acesso a esta área.', 'error');
    return;
  }

  for (const view of qsa('.view')) {
    view.classList.toggle('is-active', view.id === `view-${secao}`);
  }
  for (const item of qsa('.nav__item')) {
    const ativo = item.dataset.view === secao;
    if (ativo) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  }

  fecharPainel();

  // O assistente responde sobre o mapa; nas tabelas ele só atrapalhava.
  chatSoNoMapa(secao === 'mapa');

  if (secao === 'admin') renderizarAdmin();
  if (secao === 'calendario') mostrarCalendario();
  if (secao === 'reservas') mostrarReservas();
  if (secao === 'projetos') mostrarProjetos();
  if (secao === 'usuarios') mostrarUsuarios();
  if (secao === 'historico') renderizarHistorico();
}

/* ===========================================================================
   Menu da conta
   =========================================================================== */

function alternarMenu(forcar?: boolean): void {
  const botao = el('conta-btn');
  const menu = el('conta-menu');
  if (!botao || !menu) return;

  const abrir = forcar ?? menu.hidden;
  show(menu, abrir);
  botao.setAttribute('aria-expanded', String(abrir));
}

function fecharMenu(): void {
  alternarMenu(false);
}

/* ===========================================================================
   Entrada e saída da sessão
   =========================================================================== */

/** "Bruno Lima" vira "BR": as duas primeiras letras do primeiro nome. */
function iniciais(nome: string): string {
  const primeiro = nome.trim().split(/\s+/).find((p) => /^\p{L}/u.test(p)) ?? '';
  return primeiro ? primeiro.slice(0, 2).toUpperCase() : '—';
}

function montarApp(usuario: Usuario): void {
  show(el('tela-entrada'), false);
  show(el('app'), true);
  mostrarChat(true);

  setText('conta-nome', usuario.nome);
  setText('conta-iniciais', iniciais(usuario.nome));
  setText('conta-perfil', usuario.cargo);
  // Antes do contexto chegar, mostra só o que não depende de permissão; o
  // resto aparece quando a resposta de /me/contexto diz o que ela alcança.
  aplicarPermissoesNoMenu();

  mostrarSecao('mapa');
  void carregarInventario();
  void carregarContexto().then(() => {
    aplicarPermissoesNoMenu();
    pintarContadorDeConvites();
    mostrarBotaoDePermissoes();
    ligarAvisos();
    preCarregarTelas();

    // Veio pelo link do e-mail de convite (/projetos?convites=1): abre direto.
    const url = new URL(window.location.href);
    if (url.searchParams.has('convites')) {
      window.history.replaceState(null, '', '/');
      mostrarSecao('projetos');
      abrirConvites();
    }
  });
}

/**
 * Lê em segundo plano o que as outras telas mostram, quando o navegador fica
 * ocioso depois do login. A primeira visita a Projetos, Usuários (a lista de
 * pessoas vem junto com Projetos) e Histórico já abre com dados, em vez de
 * esperar a rede; cada tela continua relendo ao ser aberta.
 */
function preCarregarTelas(): void {
  const quandoOcioso = (tarefa: () => void): void => {
    if ('requestIdleCallback' in window) window.requestIdleCallback(tarefa, { timeout: 2000 });
    else setTimeout(tarefa, 300);
  };

  quandoOcioso(() => {
    if (!usuarioAtual()) return;
    void carregarProjetos();
    if (podeVerSecao('historico')) preCarregarHistorico();
  });
}

/**
 * Lê o inventário e só então desenha os marcadores.
 *
 * Quando a API não responde, isto mostra a tela de falha em vez de deixar o
 * mapa vazio: antes, sem API, a tela subia sem nenhum marcador e sem dizer
 * nada — parecia que o cadastro das 50 estufas havia desaparecido.
 */
async function carregarInventario(): Promise<void> {
  try {
    await carregarEstado('manter');
  } catch (erro) {
    mostrarFalha(statusDoErro(erro), erro instanceof Error ? erro.message : undefined);
    return;
  }

  esconderFalha();
  renderizarMarcadores();
  if (podeVerSecao('admin')) renderizarAdmin();
}

function desmontarApp(): void {
  desligarAvisos();
  limparContexto();
  esconderFalha();
  fecharTodosModais();
  fecharMenu();
  mostrarChat(false);
  show(el('app'), false);
  show(el('tela-entrada'), true);
}

/* ===========================================================================
   Ações declaradas no HTML
   =========================================================================== */

function registrarTodasAsAcoes(): void {
  registrarAcoes({
    // casca
    ver: (elemento) => mostrarSecao((elemento.dataset.view as Secao) ?? 'mapa'),
    'alternar-menu': () => alternarMenu(),
    sair: () => {
      fecharMenu();
      sair();
    },
    abrir: (elemento) => {
      fecharMenu();
      const id = elemento.dataset.modal;
      if (id) abrirModal(id);
    },
    fechar: () => fecharTodosModais(),
    'alternar-senha': (elemento) => alternarVisibilidadeSenha(elemento),
    // telas publicas de senha (views/acesso.ts)
    'abrir-esqueci': () => abrirEsqueci(),
    'voltar-entrada': () => voltarParaEntrada(),
    'ir-entrada': () => irParaEntrada(),
    'alternar-senha-pronta': (elemento) => alternarSenhaPronta(elemento),
    'tentar-de-novo': () => repetirDepoisDaFalha(),


    // mapa
    'abrir-espaco': (elemento) => {
      const id = elemento.dataset.id;
      if (id) abrirPainel(id);
    },
    'fechar-painel': () => fecharPainel(),
    'mapa-resultado': (elemento) => {
      const id = elemento.dataset.id;
      if (id) escolherResultado(id);
    },
    'mapa-popover': (elemento) => alternarPopover(elemento),
    // permissoes de uma pessoa (cabecalho da tela de usuarios)
    'abrir-permissoes-usuarios': () => void abrirPermissoesDeUsuarios(),
    'salvar-perm-sistema': () => void salvarPermissoesDoSistema(),
    'salvar-perm-projeto': (elemento) => void salvarPermissoesDoProjeto(Number(elemento.dataset.projeto)),

    // sino de avisos (no lugar da antiga tela cheia)
    'abrir-avisos': (elemento) => void abrirAvisos(elemento),
    'ir-aviso': (elemento) => irParaAviso(Number(elemento.dataset.indice)),
    'mapa-zoom': (elemento) => ajustarZoom(elemento.dataset.direcao ?? 'mais'),
    'mapa-centralizar': () => centralizarMapa(),
    'mapa-ver-todas': () => alternarProximas(),
    'sem-acao': () => {},

    // reservas
    'descartar-reserva': () => cancelarPreenchimentoDaReserva(),
    'abrir-reservar': (elemento) => {
      const id = elemento.dataset.id;
      if (id) abrirModalReservar(id);
    },
    'reservar-unidade': (elemento) => {
      escolherUnidade(elemento.dataset.unidade);
      guardarRascunhoDaReserva();
    },
    ...acoesDoCalendario,
    'ver-reserva': (elemento) => {
      const id = elemento.dataset.id;
      if (id) verReserva(id);
    },
    'cancelar-reserva-atual': () => void cancelarReservaAberta(),
    'editar-reserva-atual': () => editarReservaAberta(),

    // assistente
    'chat-alternar': () => alternarChat(),
    'chat-fechar': () => fecharChat(),
    'chat-limpar': () => limparConversa(),
    'chat-sugerir': (elemento) => sugerir(elemento.dataset.texto ?? ''),

    // administração
    'abrir-painel-metricas': () => abrirPainelMetricas(),
    'abrir-novo-usuario': () => abrirNovoUsuario(),
    'editar-espaco': (elemento) => {
      const id = elemento.dataset.id;
      if (id) abrirEditarEspaco(id);
    },
    'escolher-estufa': (elemento) => {
      const id = elemento.dataset.id;
      if (id) escolherEstufa(id);
    },
    'ir-para': (elemento) => irPara(elemento.dataset.target ?? 'espacos'),
    'filtrar-reservas': (elemento) => {
      const status = elemento.dataset.status as 'todas' | 'pendente' | 'ativa';
      filtrarReservas(status ?? 'todas', elemento);
    },
    'filtrar-usuarios': (elemento) => {
      filtrarUsuarios((elemento.dataset.filtro as FiltroUsuario) ?? 'todos');
    },
    'limpar-busca': (elemento) => {
      const alvo = elemento.dataset.target;
      limparBusca(alvo === 'reservas' || alvo === 'usuarios' ? alvo : 'espacos');
    },
    'aprovar-reserva': (elemento) => {
      const id = elemento.dataset.id;
      if (id) void aprovarReserva(id);
    },
    'cancelar-reserva': (elemento) => {
      const id = elemento.dataset.id;
      if (id) void cancelarReserva(id);
    },
    'reenviar-convite': (elemento) => {
      const id = elemento.dataset.id;
      if (id) void reenviarConviteDoUsuario(id);
    },
    'alternar-acesso': (elemento) => {
      const id = elemento.dataset.id;
      if (id) void alternarAcesso(id, elemento.dataset.ativo === 'true');
    },

    // projetos, equipe e permissões
    'abrir-novo-projeto': () => abrirNovoProjeto(),
    'limpar-busca-projetos': () => limparBuscaDeProjetos(),
    'editar-projeto': (elemento) => {
      const id = elemento.dataset.id;
      if (id) abrirEditarProjeto(id);
    },
    'excluir-projeto': (elemento) => {
      const id = elemento.dataset.id;
      if (id) void pedirExclusaoProjeto(id);
    },
    // convites para projetos
    'abrir-convites': () => abrirConvites(),
    'aba-convites': (elemento) => trocarAba(elemento.dataset.aba === 'enviados' ? 'enviados' : 'recebidos'),
    'abrir-convidar': (elemento) => {
      const id = Number(elemento.dataset.id);
      if (id) abrirConvidar(id, elemento.dataset.titulo ?? '');
    },
    'aceitar-convite': (elemento) => {
      const id = Number(elemento.dataset.id);
      if (id) void responderConvite(id, 'aceitar');
    },
    'recusar-convite': (elemento) => {
      const id = Number(elemento.dataset.id);
      if (id) void responderConvite(id, 'recusar');
    },
    'cancelar-convite': (elemento) => {
      const id = Number(elemento.dataset.id);
      if (id) void desistirDoConvite(id);
    },
    'filtrar-projetos': (elemento) => {
      const f = elemento.dataset.filtro;
      filtrarProjetos(f === 'meus' || f === 'outros' ? f : 'todos');
    },
    'aprovar-projeto': (elemento) => {
      const id = elemento.dataset.id;
      if (id) void decidirProjeto(id);
    },
    'recusar-projeto': (elemento) => {
      const id = elemento.dataset.id;
      if (id) void recusarProjetoAberto(id);
    },
    'ver-projeto': (elemento) => {
      const id = elemento.dataset.id;
      if (id) void abrirFichaDoProjeto(id);
    },
    'abrir-equipe': (elemento) => {
      const id = elemento.dataset.id;
      if (id) abrirEquipe(id);
    },
    'voltar-projetos': () => voltarParaProjetos(),
    'remover-membro': (elemento) => {
      const id = elemento.dataset.id;
      if (id) void removerMembroDaEquipe(id);
    },


    // histórico de alterações
    'limpar-auditoria': () => limparFiltrosAuditoria(),
    'paginar-auditoria': (elemento) => paginarAuditoria(elemento.dataset.direcao ?? 'proxima'),

    // editar usuário e reserva
    'editar-usuario': (elemento) => {
      const id = elemento.dataset.id;
      if (id) abrirEditarUsuario(id);
    },
    'editar-reserva': (elemento) => {
      const id = elemento.dataset.id;
      if (id) abrirEditarReserva(id);
    },
    'excluir-reserva-aberta': () => void excluirReservaAberta(),

  });
}

/* ===========================================================================
   Formulários, campos e teclado
   =========================================================================== */

function ligarFormularios(): void {
  el<HTMLFormElement>('form-entrada')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    void entrar();
  });

  el<HTMLFormElement>('form-reservar')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    void confirmarReserva();
  });

  // Cada tecla no formulario de reserva vira rascunho: fechar sem querer deixou
  // de apagar o que a pessoa ja tinha preenchido.
  const guardarRascunho = debounce(() => guardarRascunhoDaReserva(), 250);

  // Fechar o modal grava na hora: o debounce acima ainda estaria esperando se
  // a pessoa fechasse e recarregasse a pagina em seguida.
  aoFecharModal((scrim) => {
    if (scrim.id === 'modal-reservar') guardarRascunhoDaReserva();
  });
  for (const evento of ['input', 'change'] as const) {
    el<HTMLFormElement>('form-reservar')?.addEventListener(evento, () => guardarRascunho());
  }

  el<HTMLInputElement>('reservar-data-inicio')?.addEventListener('change', ajustarFimDoPeriodo);
  el<HTMLInputElement>('reservar-data-fim')?.addEventListener('change', () => {
    void consultarDisponibilidade();
  });

  // Mudar a quantidade reconsulta quanto sobra no periodo, sem enxurrada de
  // requisicoes enquanto a pessoa digita.
  const reconsultar = debounce(() => void consultarDisponibilidade(), 400);
  el<HTMLInputElement>('reservar-quantidade')?.addEventListener('input', () => reconsultar());

  el<HTMLFormElement>('form-novo-usuario')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    void confirmarNovoUsuario();
  });

  el<HTMLFormElement>('form-espaco')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    void confirmarEspaco();
  });

  el<HTMLFormElement>('form-projeto')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    void confirmarProjeto();
  });

  // Cartao de projeto: clicar em qualquer parte que nao seja botao abre a
  // ficha (so o titulo era clicavel e ninguem percebia).
  el('lista-projetos')?.addEventListener('click', (ev) => {
    const alvo = ev.target as Element;
    if (alvo.closest('button, a, input, select, label')) return;
    const cartao = alvo.closest<HTMLElement>('.pcard[data-projeto]');
    if (cartao?.dataset.projeto) void abrirFichaDoProjeto(cartao.dataset.projeto);
  });

  el<HTMLFormElement>('form-lideranca')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    void confirmarPassagemDeLideranca();
  });

  el<HTMLFormElement>('form-convidar')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    void enviarConvites();
  });

  el<HTMLFormElement>('form-equipe-membro')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    void incluirMembro();
  });

  el<HTMLFormElement>('form-editar-usuario')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    void confirmarEdicaoUsuario();
  });

  el<HTMLFormElement>('form-editar-reserva')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    void confirmarEdicaoReserva();
  });

  // Mesma dança do formulário de nova reserva: o fim acompanha o início e
  // cada mudança reconsulta quanto sobra no período, sem enxurrada de
  // requisições enquanto a pessoa digita a quantidade.
  el<HTMLInputElement>('editar-reserva-inicio')?.addEventListener('change', () => {
    ajustarFimDaEdicao();
    void consultarDisponibilidadeDaEdicao();
  });

  el<HTMLInputElement>('editar-reserva-fim')?.addEventListener('change', () => {
    void consultarDisponibilidadeDaEdicao();
  });

  const reconsultarEdicao = debounce(() => void consultarDisponibilidadeDaEdicao(), 400);
  el<HTMLInputElement>('editar-reserva-quantidade')?.addEventListener('input', () => {
    reconsultarEdicao();
  });

  // O campo de codigo e tambem a busca da estufa: digitar filtra, as setas
  // andam na lista e Enter escolhe. Com a lista fechada, Enter volta a ser
  // Enter e envia o formulario.
  const codigoEstufa = el<HTMLInputElement>('espaco-codigo');
  codigoEstufa?.addEventListener('input', () => {
    buscarEstufaNoFormulario(codigoEstufa.value);
  });

  codigoEstufa?.addEventListener('keydown', (ev) => {
    if (!['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(ev.key)) return;
    const tratou = navegarSugestoesDeEspaco(ev.key);
    if (!tratou) return;
    ev.preventDefault();
    // Esc com a lista aberta fecha so a lista; com ela fechada, o modal.
    if (ev.key === 'Escape') ev.stopPropagation();
  });
}

function ligarBuscas(): void {
  const buscaEspacos = debounce((valor: string) => buscarEspacos(valor));
  el<HTMLInputElement>('busca-espacos')?.addEventListener('input', (ev) => {
    buscaEspacos((ev.target as HTMLInputElement).value);
  });

  const buscaReservas = debounce((valor: string) => buscarReservas(valor));
  el<HTMLInputElement>('busca-reservas')?.addEventListener('input', (ev) => {
    buscaReservas((ev.target as HTMLInputElement).value);
  });

  const buscaUsuarios = debounce((valor: string) => buscarUsuarios(valor));
  el<HTMLInputElement>('busca-usuarios')?.addEventListener('input', (ev) => {
    buscaUsuarios((ev.target as HTMLInputElement).value);
  });

  // Nos logs a busca vai ao servidor (a trilha é paginada), por isso espera
  // a pessoa parar de digitar um pouco mais que as outras.
  const buscaLogs = debounce((valor: string) => definirFiltroAuditoria('busca', valor), 350);
  el<HTMLInputElement>('auditoria-busca')?.addEventListener('input', (ev) => {
    buscaLogs((ev.target as HTMLInputElement).value);
  });

  const buscaProjetos = debounce((valor: string) => buscarProjetos(valor));
  el<HTMLInputElement>('busca-projetos')?.addEventListener('input', (ev) => {
    buscaProjetos((ev.target as HTMLInputElement).value);
  });
}

/** Selects declaram o que fazem com `data-change`, como os cliques com `data-action`. */
function ligarSelects(): void {
  document.addEventListener('change', (ev) => {
    const alvo = ev.target;

    // Os filtros do histórico são selects E campos de data, por isso vêm antes
    // da checagem de select.
    if (
      (alvo instanceof HTMLSelectElement || alvo instanceof HTMLInputElement)
      && alvo.dataset.change === 'filtro-auditoria'
    ) {
      const campo = alvo.dataset.campo;
      if (campo) definirFiltroAuditoria(campo, alvo.value);
      return;
    }

    if (!(alvo instanceof HTMLSelectElement)) return;

    const id = alvo.dataset.id;
    if (!id) return;

    if (alvo.dataset.change === 'papel-membro') {
      void alterarPapelMembro(id, alvo.value);
      return;
    }

    if (alvo.dataset.change !== 'situacao-espaco') return;

    alvo.dataset.status = alvo.value;
    void alterarSituacaoEspaco(id, alvo.value);
  });
}

function ligarTeclado(): void {
  // Clique fora fecha o menu da conta.
  document.addEventListener('click', (ev) => {
    const alvo = ev.target;
    if (!(alvo instanceof Element)) return;
    if (alvo.closest('#conta-btn') || alvo.closest('#conta-menu')) return;
    fecharMenu();
  });

  // Esc fecha o menu da conta e devolve o foco ao botão.
  el('conta-menu')?.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    fecharMenu();
    el('conta-btn')?.focus();
  });
}

/* ===========================================================================
   Boot
   =========================================================================== */

export function iniciarApp(): void {
  iniciarAcoes();
  // Views pedem troca de tela sem importar a casca (evita ciclo).
  aoNavegar(mostrarSecao);
  iniciarModais();
  iniciarMapa();
  iniciarChat();

  registrarTodasAsAcoes();
  ligarFormularios();
  ligarBuscas();
  ligarSelects();
  ligarTeclado();

  // Uma mudança de dado atualiza marcadores e, se estiver aberta, a administração.
  aoMudar(() => {
    sincronizarMarcadores();
    if (podeVerSecao('admin')) renderizarAdmin();
  });

  // "Tentar de novo" refaz exatamente o que falhou: reler o inventário.
  aoRepetir(() => {
    if (usuarioAtual()) void carregarInventario();
  });

  // Token morto no meio da sessão: a pessoa volta para a entrada na hora, em
  // vez de seguir vendo dados velhos com um token que não vale mais.
  aoPerderSessao((mensagem) => {
    esconderFalha();
    if (usuarioAtual()) {
      sair();
      aviso(mensagem, 'info');
    }
  });

  // Chegou pelo link do e-mail (/definir-senha?token=...): a tela de senha
  // toma o lugar da entrada e nenhuma sessao e restaurada por cima. Mas o
  // "Entrar" depois de criar a senha precisa saber abrir o sistema.
  if (iniciarAcesso()) {
    ligarAutenticacao(montarApp, desmontarApp);
    return;
  }

  iniciarAutenticacao(montarApp, desmontarApp);
}
