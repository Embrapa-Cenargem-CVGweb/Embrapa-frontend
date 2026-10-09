# CVGWeb · Front-end

Interface web do **Sistema de Gestão de Campos Experimentais da Embrapa
Cenargen**: consulta dos espaços experimentais sobre a foto aérea do campus,
reserva de casas de vegetação e administração de espaços, reservas e usuários.

HTML, CSS e TypeScript sem framework, empacotados com Vite.

## Rodando

```bash
npm install
npm run dev        # servidor de desenvolvimento em http://localhost:5173
npm run build      # checagem de tipos + pacote de produção em dist/
npm run preview    # serve o dist/ para conferir o pacote
npm run typecheck  # só a checagem de tipos
npm run icons      # regenera o sprite de ícones dentro do index.html
```

## Modo demonstração

Sem `VITE_API_URL` no `.env`, ou com `VITE_USE_MOCK=true`, o app roda com 50
espaços de exemplo (`src/data/mock.ts`) e guarda reservas e status no
localStorage do navegador. Para voltar ao estado original antes de uma
apresentação, limpe os dados do site ou rode no console:

```js
localStorage.clear(); location.reload();
```

Credenciais de demonstração: `pesquisador` / `embrapa123` e `admin` /
`admin123`. Os dois botões no topo da tela de entrada preenchem o formulário.

## Estrutura

```
index.html            marcação completa; o sprite de ícones é inline
assets/
  MapEstufa.webp      foto aérea (fallback .jpg para navegadores antigos)
  icons.svg           sprite dos ícones — fonte do que é injetado no HTML
  fonts/              IBM Plex Sans e Mono, subconjunto latin, .woff2
scripts/
  build-icons.mjs     injeta assets/icons.svg no index.html
styles/
  tokens.css          cor, tipografia, espaço, raio, sombra e motion
  base.css            @font-face, reset, foco, utilidades de acessibilidade
  layout.css          casca: lateral, área principal, troca de views
  components.css      botão, campo, pill, chip, tabela, modal, toast, card
  login.css           tela de entrada
  map.css             foto, marcadores, legenda e ficha do espaço
  admin.css           página de administração
src/
  main.ts             ponto de entrada
  app.ts              navegação, menu da conta, registro das ações
  types.ts            tipos de domínio
  lib/
    actions.ts        delegação de eventos por data-action
    bus.ts            aviso de mudança nos dados
    dom.ts            atalhos de DOM
    format.ts         status, datas e plurais
    html.ts           template de HTML com escape automático
    modal.ts          modais acessíveis e diálogo de confirmação
    toast.ts          avisos temporários
  chat/
    base-conhecimento.md  o que o assistente sabe e como responde
    contexto.ts           injeta o estado do sistema nesse .md
  data/               estado, dados de exemplo e coordenadas dos marcadores
  services/api.ts     chamadas à API Laravel
  services/llm.ts     chamada à LLM do assistente (Groq)
  views/              login, mapa, reservas, administração, assistente
```

## Convenções

**Tokens.** Nenhum arquivo além de `styles/tokens.css` escreve um valor de cor
literal. Para mudar a paleta, mude os tokens; os componentes acompanham. O
sistema tem um tema só, o claro: `color-scheme` está fixo em `light` e nada
reage a `prefers-color-scheme`.

**Sem `onclick` e sem `window`.** Todo controle declara o que faz num atributo
`data-action`, e um único listener no documento (`lib/actions.ts`) encaminha
para a função registrada. Selects usam `data-change` do mesmo jeito. Para
acrescentar um comportamento: ponha o `data-action` no HTML e registre o
handler em `registrarTodasAsAcoes()`, em `src/app.ts`.

**Escape.** Texto vindo da API ou digitado por alguém sempre entra pelo template
`html` de `lib/html.ts`, que escapa toda interpolação. Para inserir marcação já
montada de propósito, use `raw()`.

**Acessibilidade.** Nenhum estado é comunicado só por cor: as pills trazem ícone
e palavra, e os marcadores do mapa têm nome acessível completo. Os modais usam
`inert` no resto da página, devolvem o foco ao fechar e fecham com Esc. O anel
de foco é um só, definido em `base.css`, e nunca é removido. `npx axe` nas telas
principais, no desktop e no celular, não aponta violações de WCAG 2.1 AA.

**Ícones.** Lucide (licença ISC), só o subconjunto usado, como sprite inline.
Para acrescentar um: pegue o SVG em <https://lucide.dev>, cole um
`<symbol id="i-nome" …>` em `assets/icons.svg` e rode `npm run icons`. O script
avisa se algum `<use>` aponta para um símbolo que não existe.

**Tipografia.** IBM Plex Sans e IBM Plex Mono auto-hospedadas em `.woff2`. Não
há requisição a CDN nenhuma: o app funciona offline e na rede interna.

## Assistente

Botão no canto inferior direito, visível depois da entrada no sistema. Responde
quem está usando cada espaço, por quanto tempo e qual projeto está lá dentro.

O que ele sabe está em `src/chat/base-conhecimento.md`: regras de resposta em
texto fixo e marcadores `{{...}}` que `src/chat/contexto.ts` preenche a cada
pergunta com o estado real (ocupação, responsável, período, projeto e
finalidade). Para mudar o comportamento do chat, edite o `.md` — não o código.

Configuração no `.env`:

```
VITE_GROQ_API_KEY=gsk_...                 # chave da Groq
VITE_GROQ_MODEL=llama-3.3-70b-versatile   # opcional
```

Sem a chave o widget abre e explica o que falta, sem chamar a rede.

> **Produção:** toda variável `VITE_` é embutida no JavaScript publicado e fica
> legível para qualquer visitante. Antes de publicar, troque o `ENDPOINT` de
> `src/services/llm.ts` por uma rota do Laravel que guarde a chave no servidor.

## Integração com a API

O front é independente do back-end. Com `VITE_API_URL` apontando para a API
Laravel, `src/data/estufas.ts` consome `/casas-vegetacao` e `/reservas` e traduz
a resposta para o modelo da interface. Se a API falhar, o app cai para os dados
de exemplo e registra o motivo no console.

O token de autenticação é lido de `localStorage` em `cvgweb:token`. Enquanto a
autenticação real não estiver ligada, a tela de entrada valida apenas no
cliente e não protege nada.
