import { create } from "zustand";

// ===========================================================================
// Context-menu state. Any UI surface can open a menu at a screen position
// with a list of entries; <ContextMenuHost/> (mounted once in App) renders
// and dismisses it. Entries are plain data so menus can be composed from
// shared builders (see ui/menus.ts) plus surface-specific items.
// ===========================================================================

export interface MenuItem {
  label: string;
  /** Human-readable shortcut hint, right-aligned (e.g. "Ctrl+C"). */
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

/** A parent item that expands into a nested menu on hover. */
export interface MenuSubmenu {
  label: string;
  disabled?: boolean;
  submenu: MenuEntry[];
}

export type MenuEntry = MenuItem | MenuSubmenu | "separator";

/** Narrow a non-separator entry to a submenu. */
export function isSubmenu(entry: MenuEntry): entry is MenuSubmenu {
  return entry !== "separator" && "submenu" in entry;
}

interface MenuState {
  menu: { x: number; y: number; entries: MenuEntry[] } | null;
  openMenu: (x: number, y: number, entries: MenuEntry[]) => void;
  closeMenu: () => void;
}

export const useMenu = create<MenuState>((set) => ({
  menu: null,
  openMenu: (x, y, entries) => set({ menu: { x, y, entries } }),
  closeMenu: () => set({ menu: null }),
}));

/** Convenience for non-React call sites (canvas handlers). */
export function openContextMenu(
  x: number,
  y: number,
  entries: MenuEntry[]
): void {
  useMenu.getState().openMenu(x, y, entries);
}
