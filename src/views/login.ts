/**
 * Entrada no sistema e gestão de usuários.
 *
 * Dois caminhos, escolhidos por `MODO_DEMO`:
 *
 * - Com a API configurada, `/login` autentica de verdade e devolve o token e o
 *   funcionário. O cadastro de usuário também vai para o banco: o back-end
 *   grava sem senha e manda por e-mail o link de criação de senha.
 * - Sem API, uma única conta local de administrador permite abrir o sistema
 *   sem back-end. A validação acontece no cliente e não protege nada.
 *
 * Os dois caminhos produzem o mesmo `Usuario`, por isso o resto do app não
 * precisa saber de onde veio a sessão.
 */
import { el, setText, show } from '../lib/dom';
import { MODO_DEMO } from '../lib/ambiente';
import { aviso } from '../lib/toast';
import {
  atualizarSituacaoFuncionario,
  criarFuncionario,
  descartarToken,
  excluirFuncionario,
  getFuncionarios,
  guardarToken,
  login as apiLogin,
  reenviarConvite,
  tokenSalvo,
  type FuncionarioApi,
} from '../services/api';
import type { PerfilUsuario, SituacaoUsuario, Usuario } from '../types';

const CHAVES = {
  usuarios: 'cvgweb:usuarios:v2',
  sessao: 'cvgweb:sessao',
} as const;

/** Senha atribuída a quem o administrador cadastra, no modo demonstração. */
const SENHA_PADRAO = 'embrapa123';

/**
 * Única conta local, para abrir o sistema enquanto a API não está ligada.
 * Os demais usuários são cadastrados pela própria administração.
 */
const SEMENTE: Usuario[] = [
  { id: 'U01', nome: 'Administrador', admin: true, cargo: 'Administrador', login: 'admin', senha: 'admin123', situacao: 'ATIVO' },
];

/* ===========================================================================
   Lista de usuários
   =========================================================================== */

function carregarDoLocal(): Usuario[] {
  try {
    const salvos = localStorage.getItem(CHAVES.usuarios);
    if (salvos) {
      const lidos = JSON.parse(salvos) as Usuario[];
      if (Array.isArray(lidos) && lidos.length) return lidos;
    }
  } catch {
    /* dados corrompidos: volta para a semente */
  }
  return SEMENTE.map((u) => ({ ...u }));
}

/** Cache da lista mostrada na administração. Com a API, vem de /funcionarios. */
const USUARIOS: Usuario[] = MODO_DEMO ? carregarDoLocal() : [];

function salvarUsuarios(): void {
  if (!MODO_DEMO) return;
  try {
    localStorage.setItem(CHAVES.usuarios, JSON.stringify(USUARIOS));
  } catch {
    /* storage indisponível */
  }
}

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
    situacao: (funcionario.situacao as SituacaoUsuario | undefined) ?? 'ATIVO',
  };
}

/** Relê a lista de usuários do banco. Em demonstração não há o que buscar. */
export async function recarregarUsuarios(): Promise<void> {
  if (MODO_DEMO) return;

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
  /** Só no modo demonstração: a senha fixa de primeiro acesso. */
  senha?: string;
  /** Mensagem do back-end, que diz para onde o convite foi. */
  mensagem?: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function proximoId(): string {
  const maior = USUARIOS.reduce((max, u) => {
    const n = Number.parseInt(u.id.replace(/\D/g, ''), 10);
    return Number.isNaN(n) ? max : Math.max(max, n);
  }, 0);
  return `U${String(maior + 1).padStart(2, '0')}`;
}

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

/** "ana.paula@embrapa.br" vira "ana.paula" — é o que se digita para entrar. */
function nickDoEmail(email: string): string {
  return (email.split('@')[0] ?? email).slice(0, 30).toLowerCase();
}

export async function cadastrarUsuario(
  emailBruto: string,
  perfil: PerfilUsuario = 'pesquisador',
): Promise<ResultadoCadastro> {
  const email = emailBruto.trim().toLowerCase();

  if (!EMAIL.test(email)) {
    return { ok: false, erro: 'Informe um e-mail válido, como nome@embrapa.br.' };
  }

  if (MODO_DEMO) return cadastrarLocal(email, perfil);

  try {
    const resposta = await criarFuncionario({
      nome: nomeDoEmail(email),
      nick: nickDoEmail(email),
      email,
      // O back-end reconhece o administrador pelo token /SU/ no perfil.
      perfil: perfil === 'admin' ? '/SU/' : '/FUNCIONARIO-C/',
    });

    await recarregarUsuarios();

    return {
      ok: true,
      usuario: resposta?.data ? daApi(resposta.data as FuncionarioApi) : undefined,
      mensagem: resposta?.message,
    };
  } catch (erro) {
    return { ok: false, erro: erro instanceof Error ? erro.message : 'Não foi possível cadastrar.' };
  }
}

function cadastrarLocal(email: string, perfil: PerfilUsuario): ResultadoCadastro {
  if (USUARIOS.some((u) => u.login.toLowerCase() === email)) {
    return { ok: false, erro: 'Este e-mail já tem acesso ao sistema.' };
  }

  const usuario: Usuario = {
    id: proximoId(),
    nome: nomeDoEmail(email),
    admin: perfil === 'admin',
    cargo: perfil === 'admin' ? 'Administrador' : 'Pesquisador',
    login: email,
    email,
    senha: SENHA_PADRAO,
    situacao: 'ATIVO',
  };

  USUARIOS.push(usuario);
  salvarUsuarios();

  return { ok: true, usuario, senha: SENHA_PADRAO };
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

  if (MODO_DEMO) {
    if (usuario.admin && USUARIOS.filter((u) => u.admin).length <= 1) {
      return { ok: false, erro: 'O sistema precisa de pelo menos um administrador.' };
    }
    USUARIOS.splice(USUARIOS.indexOf(usuario), 1);
    salvarUsuarios();
    return { ok: true, eraEuMesmo };
  }

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
  if (MODO_DEMO) {
    const usuario = USUARIOS.find((u) => u.id === id);
    if (usuario) usuario.situacao = ativo ? 'ATIVO' : 'INATIVO';
    salvarUsuarios();
    return { ok: true };
  }

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
  if (MODO_DEMO) {
    return { ok: true, mensagem: 'No modo demonstração não há envio de e-mail.' };
  }

  try {
    const resposta = await reenviarConvite(Number(id));
    await recarregarUsuarios();
    return { ok: true, mensagem: resposta?.message ?? 'Convite enviado.' };
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
}

/** Callbacks que a casca da aplicação registra no boot. */
let aoEntrar: (usuario: Usuario) => void = () => {};
let aoSair: () => void = () => {};

export async function entrar(): Promise<void> {
  const login = (el<HTMLInputElement>('entrada-usuario')?.value ?? '').trim();
  const senha = el<HTMLInputElement>('entrada-senha')?.value ?? '';

  if (!login || !senha) {
    mostrarErro('Informe usuário e senha.');
    return;
  }

  const botao = el<HTMLButtonElement>('entrada-enviar');
  if (botao) botao.disabled = true;

  try {
    sessao = MODO_DEMO ? entrarLocal(login, senha) : await entrarPelaApi(login, senha);
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

function entrarLocal(login: string, senha: string): Usuario | null {
  const usuario = USUARIOS.find((u) => u.login === login && u.senha === senha);
  if (!usuario) return null;
  if (usuario.situacao === 'INATIVO') throw new Error('Este acesso está desativado.');
  return usuario;
}

async function entrarPelaApi(login: string, senha: string): Promise<Usuario> {
  const resposta = await apiLogin(login, senha);
  guardarToken(resposta.token);
  return daApi(resposta.funcionario);
}

function guardarSessao(usuario: Usuario): void {
  try {
    // No modo demonstração basta o id: o usuário vem da lista local, assim
    // mudanças de perfil e exclusões valem na volta. Com a API, o funcionário
    // é guardado inteiro, já que não há lista local para consultar.
    localStorage.setItem(
      CHAVES.sessao,
      MODO_DEMO ? usuario.id : JSON.stringify(usuario),
    );
  } catch {
    /* storage indisponível */
  }
}

export function sair(): void {
  sessao = null;
  descartarToken();
  try {
    localStorage.removeItem(CHAVES.sessao);
  } catch {
    /* storage indisponível */
  }

  for (const campo of ['entrada-usuario', 'entrada-senha']) {
    const node = el<HTMLInputElement>(campo);
    if (node) node.value = '';
  }
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
    salvo = localStorage.getItem(CHAVES.sessao);
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
      localStorage.removeItem(CHAVES.sessao);
    } catch {
      /* storage indisponível */
    }
    aviso('Sua sessão expirou. Entre novamente.', 'info');
  }
  aoSair();
}

function recuperarSessao(salvo: string): Usuario | null {
  if (MODO_DEMO) return USUARIOS.find((u) => u.id === salvo) ?? null;

  // Com a API, a sessão só vale enquanto houver token.
  if (!tokenSalvo()) return null;
  try {
    const usuario = JSON.parse(salvo) as Usuario;
    return usuario && usuario.id ? usuario : null;
  } catch {
    return null;
  }
}
