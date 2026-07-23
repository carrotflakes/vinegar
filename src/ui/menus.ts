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

/**
 * The application File menu (AppBar dropdown). Organised into groups and an
 * Export submenu rather than mirroring registry order. Shares the context-menu
 * data model and renderer, so labels/enabled/shortcuts stay in sync.
 */
export function fileMenu(): MenuEntry[] {
  // Inside the Export submenu the "Export " prefix is redundant with the parent.
  const exportItem = (id: string): MenuItem => {
    const it = item(id);
    return { ...it, label: it.label.replace(/^Export /, "") };
  };
  return [
    item("file.new"),
    item("file.open"),
    item("file.importSvg"),
    item("file.placeImage"),
    "separator",
    item("file.save"),
    {
      label: "Export",
      submenu: [
        exportItem("file.exportImage"),
        exportItem("file.exportSvg"),
        exportItem("file.exportArtboardSvg"),
        exportItem("file.exportAllArtboardsPng"),
      ],
    },
    "separator",
    item("app.preferences"),
  ];
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
  ];
  // Group path & boolean ops into submenus so the top level stays short; each
  // submenu lists only its currently-applicable items (omitted entirely if none).
  const pathItems = [
    "structure.convertToPath",
    "path.outlineStroke",
    "path.simplify",
    "path.smooth",
    "path.flatten",
    "path.reverse",
  ]
    .filter(enabled)
    .map((id) => item(id));
  const boolItems = ["path.union", "path.subtract", "path.intersect", "path.exclude"]
    .filter(enabled)
    .map((id) => item(id));
  if (pathItems.length || boolItems.length) {
    entries.push("separator");
    if (pathItems.length) entries.push({ label: "Path", submenu: pathItems });
    if (boolItems.length) entries.push({ label: "Boolean", submenu: boolItems });
  }
  entries.push("separator", item("symbol.create"));
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

/** Actions for the artboard selected by an Artboards panel row. */
export function artboardMenu(): MenuEntry[] {
  return [
    item("view.fitArtboard"),
    "separator",
    item("file.exportArtboardPng"),
    item("file.exportArtboardSvg"),
    "separator",
    item("artboard.delete"),
  ];
}
