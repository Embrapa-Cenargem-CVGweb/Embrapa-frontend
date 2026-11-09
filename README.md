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

Com `VITE_API_URL` apontando para a API Laravel, `src/data/estufas.ts` consome
`/casas-vegetacao` e `/reservas` e traduz a resposta para o modelo da
interface. Se a API falhar no primeiro carregamento, o app cai para os dados de
exemplo e registra o motivo no console; numa releitura no meio da sessão ele
mantém o que já estava na tela, para não trocar dado real por exemplo.

**Toda escrita também vai para a API** (`src/services/api.ts`): reservar,
aprovar, cancelar, mudar a situação do espaço, cadastrar espaço e cadastrar,
desativar ou excluir usuário. Depois de gravar, o estado é relido do banco — a
tela nunca fica adiantada em relação ao que foi salvo.

A autenticação é real: `/login` devolve um token Sanctum, guardado em
`localStorage` em `cvgweb:token` e enviado em toda requisição. Quem foi
cadastrado pela administração e ainda não criou a senha pelo link do convite
recebe uma mensagem explicando isso, em vez do erro genérico.

## Testes de ponta a ponta (Playwright)

A suíte usa o sistema como uma pessoa usa: entra com usuário e senha, cadastra
espaço, reserva quantidade, aprova, cancela — e recarrega a página para
conferir que o que foi feito sobreviveu, ou seja, está no banco e não na
memória do navegador.

```bash
# uma vez
npm install

# o sistema precisa estar no ar: API + banco + front
docker compose -f ../docker-compose.yml up -d     # API em :8000 e MySQL
npm run dev                                       # front em :5173

# em outro terminal
npm run test:e2e           # roda tudo
npm run test:e2e:ui        # modo interativo, para ver passo a passo
npm run test:e2e:report    # abre o relatório da última execução
```

O front precisa estar apontando para a API, com `VITE_API_URL` preenchida no
`.env`.

Variáveis que a suíte aceita:

| Variável | Para que serve | Padrão |
| --- | --- | --- |
| `CVG_URL` | endereço do front | `http://localhost:5173` |
| `CVG_API` | endereço da API | `http://localhost:8000/api` |
| `CVG_NICK` / `CVG_SENHA` | usuário do teste | `SU` / `super123` |
| `CVG_RUN` | sufixo dos dados criados, para rodar várias vezes | `T1` |
| `CVG_ESTUFA` | estufa real usada no teste de reserva pela tela | `CVG50` |

### Ela é segura para rodar contra banco com dado de verdade

- Toda estufa que a suíte cria tem o código com prefixo `E2E`, e os auxiliares
  **recusam** apagar ou alterar qualquer código sem esse prefixo. O cadastro
  das 50 estufas do Cenargen nunca é alterado — nem nome, nem capacidade.
- A limpeza só cancela reservas cuja finalidade traz a marca `E2E`; reserva de
  pesquisador nenhum é tocada.
- Um único teste usa uma estufa real (a reserva pela tela só existe no mapa).
  Mesmo esse só cria reserva marcada, afere a diferença e cancela no fim.
- Espaço de teste que não pode ser excluído (porque já teve reserva, e o
  histórico não pode ficar órfão) é marcado como `INATIVA`, para não contar no
  painel.

Ainda assim, rodar contra um banco de desenvolvimento é o certo.
