import type { Vec2 } from "@/model/types";
import type { EditorState } from "@/store/state";

/** A single key chord. `mod` means Ctrl (or Cmd on macOS). */
export interface KeyStroke {
  key: string;
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
}

/** Runtime context a command may need (e.g. the point a menu opened at). */
export interface CommandContext {
  at?: Vec2;
}

export interface Command {
  id: string;
  label: string;
  /** Palette grouping / section. */
  group: string;
  /** Trigger chords. The first is used for display. */
  keys?: KeyStroke[];
  /** Whether the command currently applies. Defaults to always-enabled. */
  enabled?: (s: EditorState) => boolean;
  run: (s: EditorState, ctx?: CommandContext) => void | Promise<void>;
  /** Destructive action (styled accordingly in menus). */
  danger?: boolean;
  /** Hide from the command palette (still keyboard/menu invocable). */
  hidden?: boolean;
}
