import { defineConfig } from 'vite';

/**
 * Front-end estático em TypeScript, sem framework.
 * O index.html da raiz é o ponto de entrada e carrega /src/main.ts como módulo.
 */
export default defineConfig({
  root: '.',

  server: {
    port: 5173,
    open: true,

    /*
     * Pastas sincronizadas (OneDrive, Drive) não emitem eventos de arquivo
     * confiáveis; o polling garante o recarregamento ao salvar.
     *
     * O custo é a tela piscando: nenhum módulo aqui aceita HMR, então QUALQUER
     * arquivo que mude vira recarregamento inteiro da página — e o OneDrive
     * reescreve arquivos com o mesmo conteúdo só para sincronizar, o que o
     * polling por mtime não distingue de uma edição de verdade.
     *
     * Daí o intervalo mais folgado e a lista do que o watcher deve ignorar:
     * nada aqui é importado pela aplicação, e cada um deles sozinho já causava
     * recarregamento (o relatório do Playwright, por exemplo, escreve dezenas
     * de arquivos ao rodar os testes).
     */
    watch: {
      // VITE_WATCH_POLLING=false desliga o polling de vez, se a maquina
      // estiver emitindo os eventos de arquivo direito.
      usePolling: process.env.VITE_WATCH_POLLING !== 'false',
      interval: 1000,
      binaryInterval: 2000,
      // Uma rajada de escritas (sincronizacao, salvar varios arquivos) vira um
      // recarregamento so, em vez de um por arquivo.
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 150 },
      ignored: [
        '**/.git/**',
        '**/node_modules/**',
        '**/dist/**',
        '**/tests/**',
        '**/test-results/**',
        '**/playwright-report/**',
        // Restos de sincronização do OneDrive.
        '**/*.tmp',
        '**/~$*',
        '**/*.partial',
      ],
    },
  },

  build: {
    outDir: 'dist',
    target: 'es2022',
    // Sem sourcemap no pacote publicado: não serve ao usuário final e
    // dobrava o tamanho dos assets.
    sourcemap: false,
    assetsInlineLimit: 2048,
    reportCompressedSize: true,
  },
});
