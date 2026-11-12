/**
 * Telas públicas de senha: "esqueci minha senha" e "definir senha".
 *
 * Todo cadastro de senha passa pelo e-mail. O adm cadastra a pessoa, o
 * back-end manda um link para `/definir-senha?token=...`, e é esta tela que o
 * link abre: confere o token, pede a senha duas vezes, grava e mostra o resumo
 * do acesso (usuário, e-mail e a senha recém-criada) antes de levar para a
 * entrada. "Esqueci minha senha" dispara o mesmo tipo de link pela tela de
 * entrada.
 *
 * Esta tela não exige sessão: quem chega pelo link ainda não tem senha.
 */
import { el, setText, show } from '../lib/dom';
import { esconderSenha } from '../lib/senha';
import { consultarTokenAcesso, definirSenha, esqueciSenha } from '../services/api';

const CAMINHO_DEFINIR = '/definir-senha';

/** Preenchido ao salvar: a tela de entrada recebe o usuário já digitado. */
let usuarioParaEntrada = '';

export function usuarioSugeridoNaEntrada(): string {
  return usuarioParaEntrada;
}

/* ===========================================================================
   Esqueci minha senha (dentro do cartão de entrada)
   =========================================================================== */

function erroEsqueci(mensagem: string | null): void {
  show(el('esqueci-erro'), Boolean(mensagem));
  if (mensagem) setText('esqueci-erro-texto', mensagem);
}

export function abrirEsqueci(): void {
  show(el('form-entrada'), false);
  show(el('form-esqueci'), true);
  show(el('esqueci-campos'), true);
  show(el('esqueci-ok'), false);
  erroEsqueci(null);
  el<HTMLInputElement>('esqueci-email')?.focus();
}

export function voltarParaEntrada(): void {
  show(el('form-esqueci'), false);
  show(el('form-entrada'), true);
  erroEsqueci(null);
  const campo = el<HTMLInputElement>('esqueci-email');
  if (campo) campo.value = '';
  el<HTMLInputElement>('entrada-usuario')?.focus();
}

async function enviarEsqueci(): Promise<void> {
  const email = (el<HTMLInputElement>('esqueci-email')?.value ?? '').trim().toLowerCase();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    erroEsqueci('Informe um e-mail válido.');
    return;
  }

  const botao = el<HTMLButtonElement>('esqueci-enviar');
  if (botao) botao.disabled = true;

  try {
    const resposta = await esqueciSenha(email);
    erroEsqueci(null);
    setText(
      'esqueci-ok-texto',
      resposta?.message ?? 'Se existir uma conta com esse e-mail, o link foi enviado.',
    );
    show(el('esqueci-campos'), false);
    show(el('esqueci-ok'), true);
  } catch (erro) {
    erroEsqueci(erro instanceof Error ? erro.message : 'Não foi possível enviar o e-mail.');
  } finally {
    if (botao) botao.disabled = false;
  }
}

/* ===========================================================================
   Definir senha (/definir-senha?token=...)
   =========================================================================== */

type Etapa = 'conferindo' | 'invalido' | 'form' | 'pronto';

function mostrarEtapa(etapa: Etapa): void {
  show(el('definir-conferindo'), etapa === 'conferindo');
  show(el('definir-invalido'), etapa === 'invalido');
  show(el('form-definir'), etapa === 'form');
  show(el('definir-pronto'), etapa === 'pronto');
}

function erroDefinir(mensagem: string | null): void {
  show(el('definir-erro'), Boolean(mensagem));
  if (mensagem) setText('definir-erro-texto', mensagem);
}

/** Token da URL, ou vazio quando não estamos na tela do link. */
function tokenDaUrl(): string {
  if (window.location.pathname.replace(/\/+$/, '') !== CAMINHO_DEFINIR) return '';
  return new URLSearchParams(window.location.search).get('token')?.trim() ?? '';
}

let token = '';

async function conferirLink(): Promise<void> {
  mostrarEtapa('conferindo');

  try {
    const dados = await consultarTokenAcesso(token);

    setText('definir-nome', dados.nome);
    setText('definir-email', dados.email);
    setText('definir-titulo', dados.primeiro_acesso ? 'Crie a sua senha' : 'Defina a nova senha');
    setText(
      'definir-desc',
      dados.primeiro_acesso
        ? 'A administração cadastrou o seu acesso. Escolha a senha que você vai usar para entrar.'
        : 'Escolha a senha nova. A anterior deixa de valer assim que você salvar.',
    );

    mostrarEtapa('form');
    el<HTMLInputElement>('definir-senha')?.focus();
  } catch (erro) {
    setText(
      'definir-invalido-texto',
      erro instanceof Error ? erro.message : 'Este link não é mais válido.',
    );
    mostrarEtapa('invalido');
  }
}

async function salvarSenha(): Promise<void> {
  const senha = el<HTMLInputElement>('definir-senha')?.value ?? '';
  const confirmacao = el<HTMLInputElement>('definir-confirmacao')?.value ?? '';

  if (senha.length < 8) {
    erroDefinir('A senha precisa ter pelo menos 8 caracteres.');
    return;
  }
  // Só tamanho deixava passar "12345678": exige letra e número, como a API.
  if (!/\p{L}/u.test(senha) || !/\d/.test(senha)) {
    erroDefinir('A senha precisa ter letras e números.');
    return;
  }
  if (senha !== confirmacao) {
    erroDefinir('As duas senhas não são iguais.');
    return;
  }

  const botao = el<HTMLButtonElement>('definir-enviar');
  if (botao) botao.disabled = true;

  try {
    const resposta = await definirSenha(token, senha, confirmacao);
    erroDefinir(null);

    // Resumo do acesso: e-mail e a senha que acabou de criar. A senha
    // fica só na memória desta tela (atributo data-), nunca em storage.
    setText('definir-pronto-texto', resposta.message);
    setText('pronto-email', resposta.email);
    const campo = el('pronto-senha');
    if (campo) {
      campo.dataset.senha = senha;
      campo.textContent = '•'.repeat(Math.max(8, senha.length));
    }
    usuarioParaEntrada = resposta.email;

    for (const id of ['definir-senha', 'definir-confirmacao']) {
      const input = el<HTMLInputElement>(id);
      if (input) input.value = '';
      esconderSenha(id);
    }

    mostrarEtapa('pronto');
  } catch (erro) {
    erroDefinir(erro instanceof Error ? erro.message : 'Não foi possível salvar a senha.');
  } finally {
    if (botao) botao.disabled = false;
  }
}

/** Mostra/esconde a senha do resumo (não é um input, então o botão genérico não serve). */
export function alternarSenhaPronta(botao: HTMLElement): void {
  const campo = el('pronto-senha');
  if (!campo) return;

  const senha = campo.dataset.senha ?? '';
  const revelar = botao.getAttribute('aria-pressed') !== 'true';

  campo.textContent = revelar ? senha : '•'.repeat(Math.max(8, senha.length));
  botao.setAttribute('aria-pressed', String(revelar));
  botao.setAttribute('aria-label', revelar ? 'Ocultar senha' : 'Mostrar senha');
  botao.setAttribute('title', revelar ? 'Ocultar senha' : 'Mostrar senha');
  botao.querySelector('.senha__ic-ver')?.toggleAttribute('hidden', revelar);
  botao.querySelector('.senha__ic-ocultar')?.toggleAttribute('hidden', !revelar);
}

/** Sai da tela do link e volta para a entrada, com o usuário já preenchido. */
export function irParaEntrada(): void {
  const senha = el('pronto-senha');
  if (senha) {
    senha.dataset.senha = '';
    senha.textContent = '••••••••';
  }

  // Tira o token da barra de endereço: um F5 não deve reabrir um link já usado.
  window.history.replaceState(null, '', '/');

  show(el('tela-definir'), false);
  show(el('tela-entrada'), true);

  const usuario = el<HTMLInputElement>('entrada-usuario');
  if (usuario && usuarioParaEntrada) {
    usuario.value = usuarioParaEntrada;
    el<HTMLInputElement>('entrada-senha')?.focus();
  } else {
    usuario?.focus();
  }
}

/* ===========================================================================
   Boot
   =========================================================================== */

/**
 * Liga os formulários e, se a URL for a do link, abre a tela de definir senha
 * no lugar da entrada. Devolve `true` nesse caso, para a casca não restaurar
 * sessão nem montar a aplicação por cima.
 */
export function iniciarAcesso(): boolean {
  el<HTMLFormElement>('form-esqueci')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    void enviarEsqueci();
  });

  el<HTMLFormElement>('form-definir')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    void salvarSenha();
  });

  token = tokenDaUrl();
  if (!token) return false;

  show(el('tela-entrada'), false);
  show(el('app'), false);
  show(el('tela-definir'), true);
  void conferirLink();

  return true;
}
