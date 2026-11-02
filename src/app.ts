/**
 * Casca da aplicação: navegação, menu da conta, tema e ligação das ações.
 *
 * Todo clique entra por um único listener delegado (lib/actions). Nenhuma função
 * é publicada em `window` e não existe `onclick` no HTML.
 */
import { carregarEstado } from './data/estufas';
import { iniciarAcoes, registrarAcoes } from './lib/actions';
import { aoMudar } from './lib/bus';
import { debounce, el, qsa, setText, show } from './lib/dom';
import { abrirModal, aoFecharModal, fecharTodosModais, iniciarModais } from './lib/modal';
import { aviso } from './lib/toast';
import type { Usuario } from './types';

import {
  abrirEditarEspaco,
  buscarEstufaNoFormulario,
  escolherEstufa,
  navegarSugestoesDeEspaco,
  abrirModalReservas,
  abrirModalUsuarios,
  abrirEspaco,
  abrirNovoUsuario,
  abrirPainelMetricas,
  alterarSituacaoEspaco,
  alternarAcesso,
  aprovarReserva,
  buscarEspacos,
  buscarReservas,
  cancelarReserva,
  confirmarEspaco,
  confirmarNovoUsuario,
  definirPerfilNovoUsuario,
  filtrarReservas,
  irPara,
  limparBusca,
  pedirExclusaoUsuario,
  reenviarConviteDoUsuario,
  renderizarAdmin,
} from './views/admin';
import {
  alternarChat,
  fecharChat,
  iniciarChat,
  limparConversa,
  mostrarChat,
  sugerir,
} from './views/chat';
import {
  entrar,
  iniciarAutenticacao,
  sair,
  usuarioAtual,
} from './views/login';
import {
  abrirPainel,
  fecharPainel,
  iniciarMapa,
  renderizarMarcadores,
  sincronizarMarcadores,
} from './views/mapa';
import {
  abrirModalReservar,
  ajustarFimDoPeriodo,
  cancelarPreenchimentoDaReserva,
  cancelarReservaAberta,
  confirmarReserva,
  consultarDisponibilidade,
  guardarRascunhoDaReserva,
  verReserva,
} from './views/reservas';
import type { PerfilUsuario } from './types';

type Secao = 'mapa' | 'admin';

/* ===========================================================================
   Navegação entre views
   =========================================================================== */

function mostrarSecao(secao: Secao): void {
  if (secao === 'admin' && !usuarioAtual()?.admin) {
    aviso('A área de administração é restrita a administradores.', 'error');
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
  if (secao === 'admin') renderizarAdmin();
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

function montarApp(usuario: Usuario): void {
  show(el('tela-entrada'), false);
  show(el('app'), true);
  mostrarChat(true);

  setText('conta-nome', usuario.nome);
  setText('conta-perfil', usuario.cargo);
  show(el('nav-admin'), usuario.admin);

  mostrarSecao('mapa');

  // Os marcadores só sobem depois que os dados chegam.
  void carregarEstado().then(() => {
    renderizarMarcadores();
    if (usuario.admin) renderizarAdmin();
  });
}

function desmontarApp(): void {
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

    // mapa
    'abrir-espaco': (elemento) => {
      const id = elemento.dataset.id;
      if (id) abrirPainel(id);
    },
    'fechar-painel': () => fecharPainel(),
    'sem-acao': () => {},

    // reservas
    'descartar-reserva': () => cancelarPreenchimentoDaReserva(),
    'abrir-reservar': (elemento) => {
      const id = elemento.dataset.id;
      if (id) abrirModalReservar(id);
    },
    'ver-reserva': (elemento) => {
      const id = elemento.dataset.id;
      if (id) verReserva(id);
    },
    'cancelar-reserva-atual': () => void cancelarReservaAberta(),

    // assistente
    'chat-alternar': () => alternarChat(),
    'chat-fechar': () => fecharChat(),
    'chat-limpar': () => limparConversa(),
    'chat-sugerir': (elemento) => sugerir(elemento.dataset.texto ?? ''),

    // administração
    'abrir-painel-metricas': () => abrirPainelMetricas(),
    'abrir-reservas': () => abrirModalReservas(),
    'abrir-usuarios': () => abrirModalUsuarios(),
    'abrir-novo-usuario': () => abrirNovoUsuario(),
    // O formulario de espaco comeca perguntando qual estufa; sem id, abre na
    // busca. 'abrir-espaco' e do mapa (painel da estufa) e nao se confunde.
    'abrir-alterar-espaco': () => abrirEspaco(),
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
    'limpar-busca': (elemento) => {
      const alvo = elemento.dataset.target === 'reservas' ? 'reservas' : 'espacos';
      limparBusca(alvo);
    },
    'aprovar-reserva': (elemento) => {
      const id = elemento.dataset.id;
      if (id) void aprovarReserva(id);
    },
    'cancelar-reserva': (elemento) => {
      const id = elemento.dataset.id;
      if (id) void cancelarReserva(id);
    },
    'excluir-usuario': (elemento) => {
      const id = elemento.dataset.id;
      if (id) void pedirExclusaoUsuario(id, sair);
    },
    'reenviar-convite': (elemento) => {
      const id = elemento.dataset.id;
      if (id) void reenviarConviteDoUsuario(id);
    },
    'alternar-acesso': (elemento) => {
      const id = elemento.dataset.id;
      if (id) void alternarAcesso(id, elemento.dataset.ativo === 'true');
    },
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
}

/** Selects declaram o que fazem com `data-change`, como os cliques com `data-action`. */
function ligarSelects(): void {
  document.addEventListener('change', (ev) => {
    const alvo = ev.target;
    if (!(alvo instanceof HTMLSelectElement)) return;
    if (alvo.dataset.change !== 'situacao-espaco') return;

    const id = alvo.dataset.id;
    if (!id) return;
    alvo.dataset.status = alvo.value;
    void alterarSituacaoEspaco(id, alvo.value);
  });
}

function ligarTeclado(): void {
  // Setas percorrem o radiogroup, como num grupo de rádio nativo.
  el('novo-usuario-perfil')?.addEventListener('keydown', (ev) => {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(ev.key)) return;
    ev.preventDefault();

    const opcoes = qsa('#novo-usuario-perfil [data-role]');
    const atual = opcoes.findIndex((o) => o === ev.target);
    if (atual === -1) return;

    const passo = ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? 1 : -1;
    const proximo = opcoes[(atual + passo + opcoes.length) % opcoes.length];
    definirPerfilNovoUsuario(proximo.dataset.role as PerfilUsuario);
    proximo.focus();
  });

  // O segmentado de perfil responde ao clique pelo próprio listener do grupo.
  el('novo-usuario-perfil')?.addEventListener('click', (ev) => {
    const opcao = (ev.target as Element).closest<HTMLElement>('[data-role]');
    if (opcao) definirPerfilNovoUsuario(opcao.dataset.role as PerfilUsuario);
  });

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
    if (usuarioAtual()?.admin) renderizarAdmin();
  });

  iniciarAutenticacao(montarApp, desmontarApp);
}
