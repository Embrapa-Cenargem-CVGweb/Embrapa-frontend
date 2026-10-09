/**
 * Entrada no sistema.
 *
 * Dois caminhos, escolhidos por `MODO_DEMO`:
 *
 * - Com a API configurada, `/login` autentica de verdade e devolve o token e o
 *   funcionário. O token vai para o localStorage e acompanha as requisições.
 * - Sem API, uma lista local de usuários permite apresentar o sistema sem
 *   back-end. A validação acontece no cliente e não protege nada.
 *
 * Os dois caminhos produzem o mesmo `Usuario`, por isso o resto do app não
 * precisa saber de onde veio a sessão.
 */
import { el, qsa, setText, show } from '../lib/dom';
import { MODO_DEMO } from '../lib/ambiente';
import { aviso } from '../lib/toast';
import {
  descartarToken,
  guardarToken,
  login as apiLogin,
  tokenSalvo,
  type FuncionarioApi,
} from '../services/api';
import type { PerfilUsuario, Usuario } from '../types';

const CHAVES = {
  usuarios: 'cvgweb:usuarios',
  sessao: 'cvgweb:sessao',
} as const;

/** Senha atribuída a quem o administrador cadastra, no modo demonstração. */
const SENHA_PADRAO = 'embrapa123';

/** Teto de administradores simultâneos, no modo demonstração. */
const MAX_ADMINS = 2;

const SEMENTE: Usuario[] = [
  { id: 'U01', nome: 'Rafael Lima', admin: false, cargo: 'Pesquisador', login: 'pesquisador', senha: 'embrapa123' },
  { id: 'U02', nome: 'Admin Cenargen', admin: true, cargo: 'Administrador', login: 'admin', senha: 'admin123' },
  { id: 'U03', nome: 'Ana Oliveira', admin: false, cargo: 'Pesquisador', login: 'ana', senha: 'embrapa123' },
];

/** O que os atalhos da tela de entrada preenchem, em cada modo. */
const ATALHOS: Record<string, { login: string; senha: string }> = MODO_DEMO
  ? {
    pesquisador: { login: 'pesquisador', senha: 'embrapa123' },
    admin: { login: 'admin', senha: 'admin123' },
  }
  : {
    pesquisador: { login: 'rafael.lima', senha: '123456' },
    admin: { login: 'admin', senha: 'admin123' },
  };

/* ===========================================================================
   Lista local (modo demonstração)
   =========================================================================== */

function carregarUsuarios(): Usuario[] {
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

const USUARIOS: Usuario[] = carregarUsuarios();

function salvarUsuarios(): void {
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

/* ===========================================================================
   Cadastro e exclusão
   =========================================================================== */

export interface ResultadoCadastro {
  ok: boolean;
  erro?: string;
  usuario?: Usuario;
  senha?: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** A gestão de usuários ainda não tem endpoint na API. */
const SEM_ENDPOINT =
  'A gestão de usuários ainda não está ligada à API. Por enquanto ela só '
  + 'funciona no modo demonstração.';

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

function totalAdmins(): number {
  return USUARIOS.filter((u) => u.admin).length;
}

export function cadastrarUsuario(
  emailBruto: string,
  perfil: PerfilUsuario = 'pesquisador',
): ResultadoCadastro {
  if (!MODO_DEMO) return { ok: false, erro: SEM_ENDPOINT };

  const email = emailBruto.trim().toLowerCase();

  if (!EMAIL.test(email)) {
    return { ok: false, erro: 'Informe um e-mail válido, como nome@embrapa.br.' };
  }
  if (USUARIOS.some((u) => u.login.toLowerCase() === email)) {
    return { ok: false, erro: 'Este e-mail já tem acesso ao sistema.' };
  }
  if (perfil === 'admin' && totalAdmins() >= MAX_ADMINS) {
    return { ok: false, erro: `O sistema aceita no máximo ${MAX_ADMINS} administradores.` };
  }

  const usuario: Usuario = {
    id: proximoId(),
    nome: nomeDoEmail(email),
    admin: perfil === 'admin',
    cargo: perfil === 'admin' ? 'Administrador' : 'Pesquisador',
    login: email,
    senha: SENHA_PADRAO,
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

export function excluirUsuario(id: string): ResultadoExclusao {
  if (!MODO_DEMO) return { ok: false, erro: SEM_ENDPOINT };

  const indice = USUARIOS.findIndex((u) => u.id === id);
  if (indice === -1) return { ok: false, erro: 'Usuário não encontrado.' };

  const usuario = USUARIOS[indice];
  if (usuario.admin && totalAdmins() <= 1) {
    return { ok: false, erro: 'O sistema precisa de pelo menos um administrador.' };
  }

  const eraEuMesmo = sessao?.id === id;
  USUARIOS.splice(indice, 1);
  salvarUsuarios();
  return { ok: true, eraEuMesmo };
}

/* ===========================================================================
   Entrada e saída
   =========================================================================== */

/** Converte o funcionário da API no usuário que o app usa. */
function daApi(funcionario: FuncionarioApi): Usuario {
  const admin = Boolean(funcionario.super_usuario) || funcionario.tipo === 'SU';
  return {
    id: String(funcionario.id),
    nome: funcionario.nome,
    admin,
    cargo: funcionario.cargo || (admin ? 'Administrador' : 'Funcionário'),
    login: funcionario.nick ?? String(funcionario.id),
  };
}

export function preencherPerfilDemo(perfil: string): void {
  const atalho = ATALHOS[perfil];
  if (!atalho) return;

  for (const botao of qsa('[data-action="usar-perfil"]')) {
    botao.setAttribute('aria-pressed', String(botao.dataset.role === perfil));
  }

  const usuario = el<HTMLInputElement>('entrada-usuario');
  const senha = el<HTMLInputElement>('entrada-senha');
  if (usuario) usuario.value = atalho.login;
  if (senha) senha.value = atalho.senha;
  mostrarErro(null);
}

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
  return USUARIOS.find((u) => u.login === login && u.senha === senha) ?? null;
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
  for (const botao of qsa('[data-action="usar-perfil"]')) {
    botao.setAttribute('aria-pressed', 'false');
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
