/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Absolute API root for production builds, e.g. "https://api.yourdomain.com/api". */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
