/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL base da API Laravel, por exemplo http://localhost:8000/api. */
  readonly VITE_API_URL?: string;
  // Não existe VITE_GROQ_API_KEY de propósito: toda variável VITE_ entra no
  // bundle e fica legível no navegador. A chave da LLM vive no back-end
  // (GROQ_API_KEY) e o front só chama POST /api/assistente.
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
