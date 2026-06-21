// Minimal typings for the EyeDropper API (Chromium). Not yet in lib.dom.
interface EyeDropperResult {
  sRGBHex: string;
}

interface EyeDropper {
  open(options?: { signal?: AbortSignal }): Promise<EyeDropperResult>;
}

interface EyeDropperConstructor {
  new (): EyeDropper;
}

interface Window {
  EyeDropper?: EyeDropperConstructor;
}
