// ===========================================================================
// Shared context-menu builders. Surfaces (canvas, layers panel) compose these
// with their own extra items. Each entry is derived from a registered Command
// (see commands/registry.ts), so labels, shortcut hints and enabled state stay
// in sync with the keyboard bindings and command palette automatically.
// ===========================================================================

import { PATH_MODIFIER_TYPES } from "../model/types";
import {
  addModifierCommandId,
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
    item("file.saveAs"),
    {
      label: "Export",
      submenu: [
        exportItem("file.exportImage"),
        exportItem("file.exportSvg"),
        exportItem("file.exportFrameSvg"),
        exportItem("file.exportAllFramesPng"),
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
    ...(enabled("style.defaultsFromSelection")
      ? [item("style.defaultsFromSelection")]
      : []),
    "separator",
    // Only meaningful for containers, so it stays out of the way otherwise.
    ...(enabled("select.children") ? [item("select.children")] : []),
    ...(enabled("select.parent") ? [item("select.parent")] : []),
    // For an instance this would duplicate "Edit symbol" below, which is the
    // clearer label for that case.
    ...(enabled("focus.enter") && !enabled("symbol.editSelected")
      ? [item("focus.enter")]
      : []),
    ...(enabled("select.children") || enabled("select.parent") || enabled("focus.enter")
      ? ["separator" as const]
      : []),
    item("structure.group"),
    item("structure.ungroup"),
    {
      label: "Transform",
      submenu: [
        item("structure.flipHorizontal"),
        item("structure.flipVertical"),
      ],
    },
    item("structure.makeClippingMask"),
    item("structure.releaseClippingMask"),
    item("structure.makeCompound"),
    item("structure.releaseCompound"),
  ];
  // Group path & boolean ops into submenus so the top level stays short; each
  // submenu lists only its currently-applicable items (omitted entirely if none).
  const pathItems: MenuEntry[] = [
    "structure.convertToPath",
    "structure.convertToBrush",
    "structure.brushToOutline",
    "path.outlineStroke",
  ]
    .filter(enabled)
    .map((id) => item(id));
  const modifierItems: MenuEntry[] = PATH_MODIFIER_TYPES
    .map(addModifierCommandId)
    .filter(enabled)
    .map((id) => item(id));
  if (enabled("path.applyModifiers")) {
    modifierItems.push("separator", item("path.applyModifiers"));
  }
  if (modifierItems.length) {
    // Keep non-destructive stack operations distinct from the bake-once path
    // cleanups while avoiding six adjacent entries in the Path menu.
    pathItems.push({ label: "Modifiers", submenu: modifierItems });
  }
  pathItems.push(
    ...[
      "path.simplify",
      "path.smooth",
      "path.flatten",
      "path.reverse",
      "path.join",
      "path.combine",
      "path.splitSubpaths",
      "path.cut",
    ]
      .filter(enabled)
      .map((id) => item(id))
  );
  const boolItems = ["path.union", "path.subtract", "path.intersect", "path.exclude", "path.divide"]
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
  // Frame-specific actions (fit, per-frame export) live here rather than in a
  // panel of their own: a frame is an ordinary node, so every surface that can
  // select one — canvas, Layers panel — offers them through this menu.
  const frameItems = ["view.fitFrame", "file.exportFramePng", "file.exportFrameSvg"]
    .filter(enabled)
    .map((id) => item(id));
  if (frameItems.length) entries.push("separator", ...frameItems);
  entries.push(
    "separator",
    item("structure.bringToFront"),
    item("structure.sendToBack"),
    "separator",
    item("edit.delete")
  );
  return entries;
}

/**
 * Actions on the node tool's selected anchors, shown when a right-click lands
 * on one. Deliberately short: everything here is about the anchors themselves,
 * not the shape they belong to (that stays on `selectionMenu`).
 */
export function nodeMenu(): MenuEntry[] {
  return [
    item("node.type.cusp"),
    item("node.type.smooth"),
    item("node.type.symmetric"),
    "separator",
    ...(enabled("path.cut") ? [item("path.cut")] : []),
    item("edit.delete"),
  ];
}

/** Menu for empty canvas space. `at` is the click point in world coords. */
export function canvasMenu(at: Vec2): MenuEntry[] {
  return [item("edit.paste", at), item("file.placeImage", at), item("select.all")];
}

/** Menu for a right-click on a ruler or a guide. */
export function guideMenu(): MenuEntry[] {
  return [
    item("guides.delete"),
    "separator",
    item("guides.toggleVisible"),
    item("guides.toggleLock"),
    item("view.toggleRulers"),
    "separator",
    item("view.toggleRulerOrigin"),
    item("view.resetRulerOrigin"),
    "separator",
    item("guides.clear"),
  ];
}
