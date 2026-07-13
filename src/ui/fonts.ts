export interface FontOption {
  name: string;
  stack: string;
}

/** Web-safe choices. The saved value is the stable display name. */
export const FONT_OPTIONS: readonly FontOption[] = [
  { name: "System Sans", stack: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
  { name: "System Serif", stack: 'ui-serif, Georgia, "Times New Roman", serif' },
  { name: "System Mono", stack: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
  { name: "Arial", stack: 'Arial, sans-serif' },
  { name: "Georgia", stack: 'Georgia, serif' },
  { name: "Times New Roman", stack: '"Times New Roman", Times, serif' },
  { name: "Verdana", stack: 'Verdana, sans-serif' },
  { name: "Trebuchet MS", stack: '"Trebuchet MS", sans-serif' },
  { name: "Courier New", stack: '"Courier New", monospace' },
] as const;

export function fontStack(name: string): string {
  return FONT_OPTIONS.find((option) => option.name === name)?.stack ??
    `"${name.replace(/["\\]/g, "")}", sans-serif`;
}
