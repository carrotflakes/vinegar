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

/* Build identity injected by `define` in vite.config.ts; read through
 * src/buildInfo.ts rather than directly. */
declare const __APP_VERSION__: string;
declare const __GIT_COMMIT__: string;
declare const __BUILD_TIME__: string;
