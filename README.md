# CVGWeb · Front-end

Interface do **CVGWeb — Sistema de Gestão de Campos Experimentais da Embrapa
Cenargen**: consulta dos espaços sobre a foto aérea do campus, pedido de
reserva e administração de espaços, reservas, projetos, usuários e logs.

HTML, CSS e TypeScript **sem framework**, empacotados com Vite.

> **Documentação técnica completa:** [repositório `Documentacao`](../Documentacao/README.md)
> — [estrutura e convenções deste front](../Documentacao/04-frontend/README.md),
> [arquitetura](../Documentacao/02-arquitetura/README.md),
> [endpoints da API](../Documentacao/06-api/README.md) e
> [testes](../Documentacao/08-testes/README.md).

---

## O que você vê na tela

| Seção | O que faz |
| :--- | :--- |
| **Mapa** | As 51 casas de vegetação marcadas sobre a foto aérea; clique abre a ficha com situação, ocupação, responsável e período |
| **Reservas** | Pedir, aprovar, cancelar e acompanhar |
| **Projetos** | Projetos, equipe, líder e permissões |
| **Usuários** | Cadastro, convite e situação |
| **Espaços** | Alteração das casas de vegetação |
| **Logs** | Auditoria de tudo que acontece |
| **Assistente** | Chat, no canto do mapa, que responde quem está usando cada espaço e até quando |

---

## Ligando o projeto

### Caminho recomendado: Docker, pela raiz

Este repositório é clonado **dentro** do repositório de orquestração, e a
forma normal de subir tudo (front + API + banco) é de lá:

```bash
cd ..                      # raiz do projeto
docker compose up -d --build
```

Interface em http://localhost:5173. Instruções completas no
[README da raiz](../README.md).

### Caminho manual: só o front

**Requisitos:** Node.js 20+ e npm. A API precisa estar no ar.

```bash
npm install
cp .env.example .env       # VITE_API_URL=http://localhost:8000/api
npm run dev                # http://localhost:5173
```

> **`VITE_API_URL` é obrigatória.** O front não tem fonte de dados local: sem a
> API no ar, o login não autentica e o mapa sobe vazio.

### Primeiro acesso

Usuário `SU`, senha `super123`. As demais contas são cadastradas pela tela de
usuários e recebem por e-mail um link para criar a própria senha.

---

## Comandos

```bash
npm run dev         # desenvolvimento
npm run build       # checagem de tipos + pacote de produção em dist/
npm run preview     # serve o dist/ para conferir o pacote
npm run typecheck   # só a checagem de tipos
npm run icons       # regenera o sprite de ícones dentro do index.html
npm run test:e2e    # testes Playwright (exigem a API no ar)
```

---

## Estrutura, em uma olhada

```
index.html     marcação completa, com o sprite de ícones inline
assets/        foto aérea, ícones e fontes auto-hospedadas
styles/        tokens.css define cor, tipografia e espaço — nada de cor literal fora dele
src/views/     uma view por seção (mapa, reservas, projetos, admin, logs, chat)
src/services/  api.ts concentra toda chamada ao Laravel
src/lib/       ações por data-action, modais, toasts, formatação e escape de HTML
```

As convenções que mantêm isso de pé — tokens de estilo, `data-action` no lugar
de `onclick`, escape automático de HTML e as regras de acessibilidade — estão
em [Documentacao/04-frontend](../Documentacao/04-frontend/README.md).

> Toda variável `VITE_` é embutida no JavaScript publicado e fica legível para
> qualquer visitante. Segredo nenhum entra aqui: a chave da LLM fica no
> back-end.
