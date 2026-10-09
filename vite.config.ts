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
    // Pastas sincronizadas (OneDrive, Drive) não emitem eventos de arquivo
    // confiáveis; o polling garante o recarregamento ao salvar.
    watch: {
      usePolling: true,
      interval: 400,
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
