/**
 * Autenticação de demonstração, com dois perfis.
 *
 * A validação é feita no cliente, portanto não protege nada de verdade: serve
 * para alternar entre as visões de pesquisador e administrador enquanto a API
 * de autenticação não está ligada.
 */
import { el, qsa, setText, show } from '../lib/dom';
import { aviso } from '../lib/toast';
import type { PerfilUsuario, Usuario } from '../types';

const CHAVES = {
  usuarios: 'cvgweb:usuarios',
  sessao: 'cvgweb:sessao',
} as const;

/** Senha atribuída a quem o administrador cadastra. */
const SENHA_PADRAO = 'embrapa123';

/** Teto de administradores simultâneos. */
const MAX_ADMINS = 2;

const SEMENTE: Usuario[] = [
  { id: 'U01', name: 'Rafael Lima', role: 'pesquisador', login: 'pesquisador', senha: 'embrapa123' },
  { id: 'U02', name: 'Admin Cenargen', role: 'admin', login: 'admin', senha: 'admin123' },
  { id: 'U03', name: 'Ana Oliveira', role: 'pesquisador', login: 'ana', senha: 'embrapa123' },
];

const CREDENCIAIS_DEMO: Record<string, { login: string; senha: string }> = {
  pesquisador: { login: 'pesquisador', senha: 'embrapa123' },
  admin: { login: 'admin', senha: 'admin123' },
};

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
  return USUARIOS.filter((u) => u.role === 'admin').length;
}

export function cadastrarUsuario(
  emailBruto: string,
  perfil: PerfilUsuario = 'pesquisador',
): ResultadoCadastro {
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
    name: nomeDoEmail(email),
    role: perfil,
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
  const indice = USUARIOS.findIndex((u) => u.id === id);
  if (indice === -1) return { ok: false, erro: 'Usuário não encontrado.' };

  const usuario = USUARIOS[indice];
  if (usuario.role === 'admin' && totalAdmins() <= 1) {
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

export function preencherPerfilDemo(perfil: string): void {
  const credencial = CREDENCIAIS_DEMO[perfil];
  if (!credencial) return;

  for (const botao of qsa('[data-action="usar-perfil"]')) {
    botao.setAttribute('aria-pressed', String(botao.dataset.role === perfil));
  }

  const usuario = el<HTMLInputElement>('entrada-usuario');
  const senha = el<HTMLInputElement>('entrada-senha');
  if (usuario) usuario.value = credencial.login;
  if (senha) senha.value = credencial.senha;
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

/** Callbacks que a casca da aplicação registra no boot. */
let aoEntrar: (usuario: Usuario) => void = () => {};
let aoSair: () => void = () => {};

export function entrar(): void {
  const login = (el<HTMLInputElement>('entrada-usuario')?.value ?? '').trim();
  const senha = el<HTMLInputElement>('entrada-senha')?.value ?? '';

  const usuario = USUARIOS.find((u) => u.login === login && u.senha === senha);
  if (!usuario) {
    mostrarErro('Usuário ou senha incorretos.');
    const campo = el<HTMLInputElement>('entrada-senha');
    if (campo) {
      campo.value = '';
      campo.focus();
    }
    return;
  }

  mostrarErro(null);
  sessao = usuario;
  try {
    localStorage.setItem(CHAVES.sessao, usuario.id);
  } catch {
    /* storage indisponível */
  }
  aoEntrar(usuario);
}

export function sair(): void {
  sessao = null;
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

/**
 * Restaura a sessão salva, se o usuário ainda existir. Guarda só o id: o
 * objeto vem da lista atual, para refletir mudanças de perfil ou exclusões.
 */
export function iniciarAutenticacao(
  entrou: (usuario: Usuario) => void,
  saiu: () => void,
): void {
  aoEntrar = entrou;
  aoSair = saiu;

  let id: string | null = null;
  try {
    id = localStorage.getItem(CHAVES.sessao);
  } catch {
    /* storage indisponível */
  }

  const salvo = id ? USUARIOS.find((u) => u.id === id) : undefined;
  if (salvo) {
    sessao = salvo;
    aoEntrar(salvo);
    return;
  }

  if (id) {
    try {
      localStorage.removeItem(CHAVES.sessao);
    } catch {
      /* storage indisponível */
    }
    aviso('Sua sessão expirou. Entre novamente.', 'info');
  }
  aoSair();
}
