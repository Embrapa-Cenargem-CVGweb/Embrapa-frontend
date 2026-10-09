/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL base da API Laravel, por exemplo http://localhost:8000/api. */
  readonly VITE_API_URL?: string;
  /** 'true' força o modo demonstração com dados locais, sem API. */
  readonly VITE_USE_MOCK?: string;
  /**
   * Chave da LLM do assistente (Groq). Atenção: toda variável VITE_ vai para o
   * bundle e fica legível no navegador — em produção, use um proxy no back-end.
   */
  readonly VITE_GROQ_API_KEY?: string;
  /** Modelo da Groq usado pelo assistente. Padrão: llama-3.3-70b-versatile. */
  readonly VITE_GROQ_MODEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
