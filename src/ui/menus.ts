// ===========================================================================
// Shared context-menu builders. Surfaces (canvas, layers panel) compose these
// with their own extra items. Builders read the store at call time, so build
// entries right when the menu opens.
// ===========================================================================

import { canGroupSelection, selectionUnits } from "../model/groups";
import {
  canMakeCompoundPathSelection,
  canReleaseCompoundPathSelection,
} from "../model/compoundPath";
import type { Vec2 } from "../model/types";
import { useEditor } from "../store/editorStore";
import type { MenuEntry } from "../store/menuStore";

const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);
export const MOD = isMac ? "⌘" : "Ctrl";

/** Actions on the current selection (clipboard, grouping, z-order, delete). */
export function selectionMenu(): MenuEntry[] {
  const s = useEditor.getState();
  const canGroup = canGroupSelection(s.doc, s.selection);
  const canUngroup = selectionUnits(s.doc, s.selection).groups.length > 0;
  const canMakeCompound = canMakeCompoundPathSelection(s.doc, s.selection);
  const canReleaseCompound = canReleaseCompoundPathSelection(s.doc, s.selection);
  const act =
    <K extends keyof typeof s>(key: K) =>
    () =>
      (useEditor.getState()[key] as () => void)();
  return [
    { label: "Cut", shortcut: `${MOD}+X`, onSelect: act("cutSelected") },
    { label: "Copy", shortcut: `${MOD}+C`, onSelect: act("copySelected") },
    {
      label: "Duplicate",
      shortcut: `${MOD}+D`,
      onSelect: act("duplicateSelected"),
    },
    "separator",
    {
      label: "Group",
      shortcut: `${MOD}+G`,
      disabled: !canGroup,
      onSelect: act("groupSelected"),
    },
    {
      label: "Ungroup",
      shortcut: `${MOD}+Shift+G`,
      disabled: !canUngroup,
      onSelect: act("ungroupSelected"),
    },
    {
      label: "Make compound path",
      shortcut: `${MOD}+8`,
      disabled: !canMakeCompound,
      onSelect: act("makeCompoundPathSelected"),
    },
    {
      label: "Release compound path",
      shortcut: `Alt+${MOD}+8`,
      disabled: !canReleaseCompound,
      onSelect: act("releaseCompoundPathSelected"),
    },
    "separator",
    { label: "Bring to front", onSelect: act("bringToFront") },
    { label: "Send to back", onSelect: act("sendToBack") },
    "separator",
    {
      label: "Delete",
      shortcut: "Del",
      danger: true,
      onSelect: act("deleteSelected"),
    },
  ];
}

/** Menu for empty canvas space. `at` is the click point in world coords. */
export function canvasMenu(at: Vec2): MenuEntry[] {
  const s = useEditor.getState();
  return [
    {
      label: "Paste here",
      shortcut: `${MOD}+V`,
      disabled: !s.clipboard,
      onSelect: () => useEditor.getState().paste(at),
    },
    {
      label: "Select all",
      shortcut: `${MOD}+A`,
      onSelect: () => useEditor.getState().selectAll(),
    },
  ];
}
