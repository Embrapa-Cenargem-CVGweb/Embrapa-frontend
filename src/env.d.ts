/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL base da API Laravel, por exemplo http://localhost:8000/api. */
  readonly VITE_API_URL?: string;
  /** 'true' força o modo demonstração com dados locais, sem API. */
  readonly VITE_USE_MOCK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
