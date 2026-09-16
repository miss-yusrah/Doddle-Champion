/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TRACKER_ADDRESS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
