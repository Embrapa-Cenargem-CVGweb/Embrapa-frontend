/**
 * Ajuda rápida dos modais.
 *
 * Cada modal que tem o que explicar ganha um "?" no cabeçalho, ao lado do
 * fechar. O clique abre um modal pequeno POR CIMA, com três ou quatro frases
 * curtas — o suficiente para a pessoa entender o formulário sem sair dele. O
 * que estava preenchido continua lá embaixo, intacto.
 *
 * Os textos moram aqui, num lugar só: mudar uma explicação não exige achar o
 * modal no HTML. O botão é colocado por código pelo mesmo motivo — modal novo
 * com ajuda é uma entrada a mais neste arquivo.
 */
import { el, qs, setText } from './dom';
import { html, icone, juntar } from './html';
import { abrirModal, fecharModal } from './modal';

interface Ajuda {
  titulo: string;
  /** Frases curtas, uma ideia por linha. */
  itens: string[];
}

/** Pelo id do modal (`.scrim`). */
const AJUDAS: Record<string, Ajuda> = {
  'modal-reservar': {
    titulo: 'Como reservar',
    itens: [
      'Você reserva só o que vai usar: uma quantidade de vasos ou de bancadas, num período. O resto da estufa continua livre para outras pessoas.',
      'O aviso verde ou vermelho mostra quanto sobra no período escolhido, antes de enviar.',
      'Toda reserva pertence a um projeto aprovado do qual você faz parte.',
      'O pedido fica aguardando a administração aprovar. Enquanto isso, ele já segura o espaço.',
    ],
  },
  'modal-reserva-editar': {
    titulo: 'Como alterar uma reserva',
    itens: [
      'Dá para mudar período, quantidade e finalidade.',
      'Se a mudança ocupa mais espaço ou outros dias, a reserva volta a aguardar aprovação.',
      'Diminuir a quantidade ou encurtar o período libera o espaço na hora.',
    ],
  },
  'modal-ver-reserva': {
    titulo: 'Sobre a reserva',
    itens: [
      'Aprovada: o espaço é do projeto no período. Aguardando: a administração ainda vai decidir.',
      'Cancelar libera os vasos ou bancadas para outras pessoas.',
      'Só quem tem permissão no projeto (ou a administração) consegue alterar ou cancelar.',
    ],
  },
  'modal-projeto': {
    titulo: 'Como funciona um projeto',
    itens: [
      'O projeto é a pesquisa: é ele que dá direito a reservar. Toda reserva aponta para um projeto.',
      'Um projeto não fica preso a uma estufa: pode ter vasos em várias.',
      'Quem propõe vira o responsável (líder). A proposta só vale depois de a administração aprovar.',
      'Os participantes entram acompanhando; as permissões de cada um são dadas em "Equipe".',
    ],
  },
  'modal-projeto-ver': {
    titulo: 'O que a ficha mostra',
    itens: [
      'A barra do topo é o período do projeto e quanto dele já passou.',
      'Os números contam a equipe, as estufas com reserva e o que está em uso hoje.',
      '"Onde está plantado" lista as reservas do projeto, com estufa, quantidade e período.',
      'Em "Documentos e anotações" a equipe guarda protocolos, imagens e observações da pesquisa.',
    ],
  },
  'modal-equipe': {
    titulo: 'Equipe e permissões',
    itens: [
      'O líder responde pelo projeto e pode chamar pessoas para a equipe.',
      'Cada pessoa tem as próprias permissões: criar, alterar ou cancelar reserva, editar o projeto, incluir gente.',
      'Quem entra sem permissão nenhuma só acompanha.',
    ],
  },
  'modal-permissoes': {
    titulo: 'Como as permissões funcionam',
    itens: [
      'Permissão de projeto vale só dentro daquele projeto.',
      'Permissão do sistema vale em todo lugar (aprovar reservas, cadastrar pessoas, configurar estufas).',
      'A administração tem todas, sempre.',
    ],
  },
  'modal-convidar': {
    titulo: 'Como convidar',
    itens: [
      'Escolha pessoas já cadastradas no sistema. Cada uma recebe o convite e decide se aceita.',
      'Só depois de aceitar a pessoa entra na equipe.',
      'Você pode desistir do convite enquanto ele não foi respondido.',
    ],
  },
  'modal-convites': {
    titulo: 'Convites de projeto',
    itens: [
      'Recebidos: projetos que chamaram você. Aceitar coloca você na equipe.',
      'Enviados: quem você chamou e o que cada um respondeu.',
    ],
  },
  'modal-novo-usuario': {
    titulo: 'Como cadastrar uma pessoa',
    itens: [
      'Basta nome, e-mail e cargo. A pessoa recebe por e-mail um link para criar a própria senha.',
      'O cargo "Administrador" dá acesso a tudo; os outros entram como usuário comum.',
      'Enquanto a pessoa não cria a senha, ela aparece como "aguardando" e o convite pode ser reenviado.',
    ],
  },
  'modal-usuario-editar': {
    titulo: 'Como alterar um cadastro',
    itens: [
      'Mudar o e-mail muda o endereço de entrada da pessoa.',
      'Desativar o acesso impede a pessoa de entrar, sem apagar o histórico dela.',
      'Quem lidera um projeto precisa passar a liderança antes de ser desativado.',
    ],
  },
  'modal-lideranca': {
    titulo: 'Passar a liderança',
    itens: [
      'Todo projeto precisa de um líder com acesso ativo.',
      'Escolha quem assume cada projeto antes de desativar a pessoa.',
    ],
  },
  'modal-espaco': {
    titulo: 'Como alterar uma estufa',
    itens: [
      'Capacidade reservável é o que as reservas consomem. Numa estufa de vasos ela é a soma dos "vasos por tamanho".',
      'As bancadas de uma estufa de vasos se reservam à parte.',
      'Temperatura é a faixa em que a estufa é mantida; aparece na ficha do mapa.',
      'Só "Disponível para reserva" aceita pedido novo. Nas outras situações, o motivo que você escrever aparece para quem tentar reservar.',
    ],
  },
  'modal-cal-dia': {
    titulo: 'A estufa neste dia',
    itens: [
      'As barras mostram quanto dos vasos e das bancadas está tomado no dia.',
      'A lista diz quem está na estufa e até quando.',
      'O botão reserva a partir deste dia, se houver vaga e você tiver um projeto aprovado.',
    ],
  },
  'modal-metricas': {
    titulo: 'O que os números contam',
    itens: [
      'A ocupação é pela capacidade (vasos e bancadas), não pelo número de estufas.',
      'Reservas pendentes já seguram espaço, por isso entram na conta.',
    ],
  },
};

function fecharAjuda(): void {
  fecharModal(el('modal-ajuda'));
}

/** Abre a explicação do modal informado, por cima dele. */
export function abrirAjuda(modalId: string | undefined): void {
  const ajuda = modalId ? AJUDAS[modalId] : undefined;
  const lista = el('ajuda-itens');
  if (!ajuda || !lista) return;

  setText('ajuda-titulo', ajuda.titulo);
  lista.innerHTML = juntar(ajuda.itens.map((item) => html`<li>${item}</li>`));
  abrirModal('modal-ajuda');
}

/** Coloca o "?" no cabeçalho de cada modal que tem explicação. */
export function iniciarAjuda(): void {
  for (const id of Object.keys(AJUDAS)) {
    const scrim = el(id);
    if (!scrim || qs('.ajuda-btn', scrim)) continue;

    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'close-btn ajuda-btn';
    botao.dataset.action = 'ajuda';
    botao.dataset.ajuda = id;
    botao.setAttribute('aria-label', 'Como funciona');
    botao.title = 'Como funciona';
    botao.innerHTML = html`${icone('circle-question-mark')}`;

    // Antes do fechar; onde o cabeçalho tem outro botão no lugar (Equipe tem
    // o "voltar"), antes dele.
    const cabecalho = qs('.dialog__head, .ficha-hero__topo', scrim);
    const fechar = cabecalho ? qs('.close-btn, .btn', cabecalho) : null;
    if (fechar) fechar.before(botao);
    else cabecalho?.append(botao);
  }

  el('ajuda-fechar')?.addEventListener('click', fecharAjuda);
  el('ajuda-entendi')?.addEventListener('click', fecharAjuda);
}
