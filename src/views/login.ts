/**
 * Entrada no sistema e gestão de usuários.
 *
 * `/login` autentica no back-end e devolve o token do Sanctum e o
 * funcionário. O cadastro de usuário vai para o banco: o back-end grava sem
 * senha e manda por e-mail o link de criação de senha.
 *
 * Não há caminho local: sem API, não há login. Autenticação conferida no
 * cliente não protege nada, e manter os dois caminhos fazia a tela mentir
 * sobre o que estava gravado.
 */
import { el, setText, show } from '../lib/dom';
import { esconderSenha } from '../lib/senha';
import { aviso } from '../lib/toast';
import {
  atualizarFuncionario,
  atualizarSituacaoFuncionario,
  criarFuncionario,
  descartarToken,
  excluirFuncionario,
  getFuncionarios,
  guardarToken,
  login as apiLogin,
  reenviarConvite,
  tokenSalvo,
  type EnvioDoConvite,
  type FuncionarioApi,
} from '../services/api';
import type { PerfilUsuario, SituacaoUsuario, Usuario } from '../types';

const CHAVES = {
  sessao: 'cvgweb:sessao',
} as const;

/* ===========================================================================
   Lista de usuários
   =========================================================================== */

/** Cache da lista mostrada na administração; vem de /funcionarios. */
const USUARIOS: Usuario[] = [];

let sessao: Usuario | null = null;

export function usuarioAtual(): Usuario | null {
  return sessao;
}

export function listarUsuarios(): readonly Usuario[] {
  return USUARIOS;
}

/** Converte o funcionário da API no usuário que o app usa. */
function daApi(funcionario: FuncionarioApi): Usuario {
  const admin = Boolean(funcionario.super_usuario) || funcionario.tipo === 'SU';
  return {
    id: String(funcionario.id),
    nome: funcionario.nome,
    admin,
    cargo: funcionario.cargo || (admin ? 'Administrador' : 'Funcionário'),
    login: funcionario.nick ?? String(funcionario.id),
    email: funcionario.email,
    matricula: funcionario.matricula ?? undefined,
    cargoId: funcionario.cargo_id ?? undefined,
    projetos: funcionario.projetos,
    ultimoAcesso: funcionario.ultimo_acesso_em ?? undefined,
    situacao: (funcionario.situacao as SituacaoUsuario | undefined)
      ?? (funcionario.ativo === false ? 'INATIVO' : 'ATIVO'),
    convite: funcionario.convite ?? null,
  };
}

/** Relê a lista de usuários do banco. */
export async function recarregarUsuarios(): Promise<void> {
  const resposta = await getFuncionarios();
  const lista: FuncionarioApi[] = resposta.data ?? resposta;

  USUARIOS.length = 0;
  for (const funcionario of lista) USUARIOS.push(daApi(funcionario));
}

/* ===========================================================================
   Cadastro, exclusão e acesso
   =========================================================================== */

export interface ResultadoCadastro {
  ok: boolean;
  erro?: string;
  usuario?: Usuario;
  /** Mensagem do back-end, que diz para onde o convite foi. */
  mensagem?: string;
  /** O que aconteceu com o e-mail do convite (saiu, não saiu, link manual). */
  convite?: EnvioDoConvite;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** "ana.paula@embrapa.br" vira "Ana Paula". */
function nomeDoEmail(email: string): string {
  const local = email.split('@')[0] ?? email;
  return (
    local
      .split(/[._-]+/)
      .filter(Boolean)
      .map((parte) => parte.charAt(0).toUpperCase() + parte.slice(1))
      .join(' ') || email
  );
}

/** Gera um identificador interno a partir do e-mail. */
function nickDoEmail(email: string): string {
  return (email.split('@')[0] ?? email).slice(0, 30).toLowerCase();
}

/**
 * Cadastra o usuário. O nome vem do formulário; quando não vier, é deduzido do
 * e-mail — o que serve para não travar o cadastro, mas rende "Ana Paula" onde
 * o certo seria "Ana Paula Ribeiro", e é esse nome que aparece na lista e nas
 * reservas. Por isso o formulário pede o nome completo.
 */
export interface DadosNovoUsuario {
  /** Em branco, é gerado a partir do e-mail. */
  nick?: string;
  matricula?: string;
  cargoId?: number | null;
}

export async function cadastrarUsuario(
  emailBruto: string,
  perfil: PerfilUsuario = 'pesquisador',
  nomeBruto = '',
  extras: DadosNovoUsuario = {},
): Promise<ResultadoCadastro> {
  const email = emailBruto.trim().toLowerCase();
  const nome = nomeBruto.trim();

  if (!EMAIL.test(email)) {
    return { ok: false, erro: 'Informe um e-mail válido, como nome@embrapa.br.' };
  }

  try {
    const resposta = await criarFuncionario({
      nome: nome || nomeDoEmail(email),
      // O identificador interno não é usado para autenticar.
      nick: (extras.nick ?? '').trim().toLowerCase() || nickDoEmail(email),
      email,
      matricula: (extras.matricula ?? '').trim() || undefined,
      cargo_id: extras.cargoId ?? null,
      // Quem é adm é decidido aqui; o perfil legado (/SU/) é montado no back-end.
      super_usuario: perfil === 'admin',
    });

    await recarregarUsuarios();

    return {
      ok: true,
      usuario: resposta?.id ? daApi(resposta as FuncionarioApi) : undefined,
      mensagem: resposta?.message,
      convite: resposta?.convite as EnvioDoConvite | undefined,
    };
  } catch (erro) {
    return { ok: false, erro: erro instanceof Error ? erro.message : 'Não foi possível cadastrar.' };
  }
}

/**
 * Salva a edição de um usuário.
 *
 * O back-end valida com `sometimes`, então o que não for enviado fica como
 * está — e ele mesmo decide o que esta pessoa tem direito de alterar: trocar
 * perfil, por exemplo, é só do adm, e o campo é ignorado para os demais.
 */
export async function editarUsuario(
  id: string,
  dados: {
    nome: string;
    email: string;
    nick: string;
    matricula?: string;
    cargoId?: number | null;
    admin?: boolean;
  },
): Promise<ResultadoCadastro> {
  const email = dados.email.trim().toLowerCase();

  if (!dados.nome.trim()) {
    return { ok: false, erro: 'Informe o nome completo da pessoa.' };
  }

  if (!EMAIL.test(email)) {
    return { ok: false, erro: 'Informe um e-mail válido, como nome@embrapa.br.' };
  }

  if (!dados.nick.trim()) {
    return { ok: false, erro: 'Informe o identificador interno.' };
  }

  try {
    const resposta = await atualizarFuncionario(Number(id), {
      nome: dados.nome.trim(),
      email,
      nick: dados.nick.trim().toLowerCase(),
      matricula: (dados.matricula ?? '').trim() || null,
      cargo_id: dados.cargoId ?? null,
      super_usuario: dados.admin,
    });

    await recarregarUsuarios();

    return {
      ok: true,
      usuario: resposta?.id ? daApi(resposta as FuncionarioApi) : undefined,
    };
  } catch (erro) {
    return { ok: false, erro: erro instanceof Error ? erro.message : 'Não foi possível salvar.' };
  }
}

export interface ResultadoExclusao {
  ok: boolean;
  erro?: string;
  eraEuMesmo?: boolean;
}

export async function excluirUsuario(id: string): Promise<ResultadoExclusao> {
  const usuario = USUARIOS.find((u) => u.id === id);
  if (!usuario) return { ok: false, erro: 'Usuário não encontrado.' };

  const eraEuMesmo = sessao?.id === id;

  try {
    await excluirFuncionario(Number(id));
    await recarregarUsuarios();
    return { ok: true, eraEuMesmo };
  } catch (erro) {
    // O back-end recusa excluir quem tem reservas e sugere desativar.
    return { ok: false, erro: erro instanceof Error ? erro.message : 'Não foi possível excluir.' };
  }
}

/** Desativa ou reativa o acesso sem apagar o histórico. */
export async function alternarAcessoUsuario(id: string, ativo: boolean): Promise<ResultadoExclusao> {
  try {
    await atualizarSituacaoFuncionario(Number(id), ativo);
    await recarregarUsuarios();
    return { ok: true, eraEuMesmo: sessao?.id === id && !ativo };
  } catch (erro) {
    return { ok: false, erro: erro instanceof Error ? erro.message : 'Não foi possível alterar o acesso.' };
  }
}

/** Reenvia o link de criação de senha. */
export async function reenviarConviteUsuario(id: string): Promise<ResultadoCadastro> {
  try {
    const resposta = await reenviarConvite(Number(id));
    await recarregarUsuarios();
    return {
      ok: true,
      mensagem: resposta?.message ?? 'Convite enviado.',
      convite: resposta?.convite as EnvioDoConvite | undefined,
    };
  } catch (erro) {
    return { ok: false, erro: erro instanceof Error ? erro.message : 'Não foi possível enviar o convite.' };
  }
}

/* ===========================================================================
   Entrada e saída
   =========================================================================== */

function mostrarErro(mensagem: string | null): void {
  const caixa = el('entrada-erro');
  show(caixa, Boolean(mensagem));
  if (mensagem) setText('entrada-erro-texto', mensagem);

  for (const campo of ['entrada-usuario', 'entrada-senha']) {
    const node = el(campo);
    if (!node) continue;
    if (mensagem) node.setAttribute('aria-invalid', 'true');
    else node.removeAttribute('aria-invalid');
  }
}

function limparSenha(): void {
  const campo = el<HTMLInputElement>('entrada-senha');
  if (campo) {
    campo.value = '';
    campo.focus();
  }
  // Senha errada: esconde de novo, para o campo nao ficar exposto na tela.
  esconderSenha('entrada-senha');
}

/** Callbacks que a casca da aplicação registra no boot. */
let aoEntrar: (usuario: Usuario) => void = () => {};
let aoSair: () => void = () => {};

export async function entrar(): Promise<void> {
  const email = (el<HTMLInputElement>('entrada-usuario')?.value ?? '').trim().toLowerCase();
  const senha = el<HTMLInputElement>('entrada-senha')?.value ?? '';

  if (!email || !senha) {
    mostrarErro('Informe seu e-mail e senha.');
    return;
  }

  const botao = el<HTMLButtonElement>('entrada-enviar');
  if (botao) botao.disabled = true;

  try {
    sessao = await entrarPelaApi(email, senha);
  } catch (erro) {
    // A API explica o caso mais comum: acesso ainda sem senha criada.
    mostrarErro(erro instanceof Error ? erro.message : 'Não foi possível entrar.');
    limparSenha();
    return;
  } finally {
    if (botao) botao.disabled = false;
  }

  if (!sessao) {
    mostrarErro('Usuário ou senha incorretos.');
    limparSenha();
    return;
  }

  mostrarErro(null);
  guardarSessao(sessao);
  aoEntrar(sessao);
}

async function entrarPelaApi(email: string, senha: string): Promise<Usuario> {
  const resposta = await apiLogin(email, senha);
  guardarToken(resposta.token);
  return daApi(resposta.funcionario);
}

function guardarSessao(usuario: Usuario): void {
  try {
    // O funcionário é guardado inteiro: não há lista local para consultar na
    // volta, e a sessão só vale enquanto o token do Sanctum estiver salvo.
    sessionStorage.setItem(CHAVES.sessao, JSON.stringify(usuario));
  } catch {
    /* storage indisponível */
  }
}

export function sair(): void {
  sessao = null;
  descartarToken();
  try {
    sessionStorage.removeItem(CHAVES.sessao);
    // Limpa rascunhos de reserva ao sair — dado do formulário não deve
    // sobreviver ao logout, especialmente em computadores compartilhados.
    localStorage.removeItem('cvgweb:rascunho-reserva:v1');
  } catch {
    /* storage indisponível */
  }

  for (const campo of ['entrada-usuario', 'entrada-senha']) {
    const node = el<HTMLInputElement>(campo);
    if (node) node.value = '';
  }
  esconderSenha('entrada-senha');
  mostrarErro(null);

  aoSair();
  el<HTMLInputElement>('entrada-usuario')?.focus();
}

/** Restaura a sessão salva, quando ela ainda é válida. */
export function iniciarAutenticacao(
  entrou: (usuario: Usuario) => void,
  saiu: () => void,
): void {
  aoEntrar = entrou;
  aoSair = saiu;

  let salvo: string | null = null;
  try {
    salvo = sessionStorage.getItem(CHAVES.sessao);
  } catch {
    /* storage indisponível */
  }

  const recuperada = salvo ? recuperarSessao(salvo) : null;
  if (recuperada) {
    sessao = recuperada;
    aoEntrar(recuperada);
    return;
  }

  if (salvo) {
    descartarToken();
    try {
      sessionStorage.removeItem(CHAVES.sessao);
    } catch {
      /* storage indisponível */
    }
    aviso('Sua sessão expirou. Entre novamente.', 'info');
  }
  aoSair();
}

function recuperarSessao(salvo: string): Usuario | null {
  // A sessão só vale enquanto houver token.
  if (!tokenSalvo()) return null;
  try {
    const usuario = JSON.parse(salvo) as Usuario;
    return usuario && usuario.id ? usuario : null;
  } catch {
    return null;
  }
}
