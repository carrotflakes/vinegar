// ===========================================================================
// Shared context-menu builders. Surfaces (canvas, layers panel) compose these
// with their own extra items. Each entry is derived from a registered Command
// (see commands/registry.ts), so labels, shortcut hints and enabled state stay
// in sync with the keyboard bindings and command palette automatically.
// ===========================================================================

import {
  commandEnabled,
  commandShortcut,
  getCommand,
  runCommand,
} from "../commands/registry";
import type { Vec2 } from "../model/types";
import type { MenuEntry, MenuItem } from "../store/menuStore";

/** Build a menu item from a command id, reading its live enabled state. */
function item(id: string, at?: Vec2): MenuItem {
  const cmd = getCommand(id);
  if (!cmd) throw new Error(`Unknown command: ${id}`);
  const shortcut = commandShortcut(cmd);
  return {
    label: cmd.label,
    ...(shortcut ? { shortcut } : {}),
    danger: cmd.danger,
    disabled: !commandEnabled(cmd),
    onSelect: () => runCommand(id, at ? { at } : undefined),
  };
}

/** Whether the given command is currently enabled against live state. */
function enabled(id: string): boolean {
  const cmd = getCommand(id);
  return cmd ? commandEnabled(cmd) : false;
}

/** Actions on the current selection (clipboard, grouping, z-order, delete). */
export function selectionMenu(): MenuEntry[] {
  const entries: MenuEntry[] = [
    item("edit.cut"),
    item("edit.copy"),
    item("edit.duplicate"),
    "separator",
    item("structure.group"),
    item("structure.ungroup"),
    item("structure.makeClippingMask"),
    item("structure.releaseClippingMask"),
    item("structure.makeCompound"),
    item("structure.releaseCompound"),
    "separator",
    item("symbol.create"),
  ];
  if (enabled("symbol.editSelected")) entries.push(item("symbol.editSelected"));
  if (enabled("symbol.detach")) entries.push(item("symbol.detach"));
  entries.push(
    "separator",
    item("structure.bringToFront"),
    item("structure.sendToBack"),
    "separator",
    item("edit.delete")
  );
  return entries;
}

/** Menu for empty canvas space. `at` is the click point in world coords. */
export function canvasMenu(at: Vec2): MenuEntry[] {
  return [item("edit.paste", at), item("file.placeImage", at), item("select.all")];
}
