/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /**
   * Set to "1" at build time to keep the render profiling switches
   * (`src/debug/renderFlags.ts`) in a production build. Unset in normal builds.
   */
  readonly VITE_RENDER_DEBUG?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
