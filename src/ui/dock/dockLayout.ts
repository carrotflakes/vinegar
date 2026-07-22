// The docked right sidebar as data: a top-to-bottom column of tab groups. Each
// group stacks one or more panels as tabs and shows one at a time, so the
// occupied width stays constant no matter how many panels exist. Tabs can be
// reordered, moved between groups, and split off into a new group — all of which
// are just pure transforms of this layout, persisted to localStorage.

const STORAGE_KEY = "vinegar.dockLayout.v1";

export interface DockGroupState {
  id: string;
  /** Panel ids, left-to-right in the tab bar. */
  tabs: string[];
  /** The visible panel id (always one of `tabs`). */
  active: string;
  /** Relative vertical size (flex-grow with flex-basis 0). */
  flex: number;
}

/** The whole dock: groups stacked top-to-bottom. */
export type DockLayout = DockGroupState[];

/** Where a dragged tab wants to land. */
export type DropTarget =
  | { kind: "tab"; groupId: string; index: number }
  // Split into a brand-new group inserted before `beforeGroupId` (null = append
  // at the bottom of the column).
  | { kind: "split"; beforeGroupId: string | null };

let seq = 0;
function newGroupId(): string {
  return `dg-${Date.now().toString(36)}-${(seq++).toString(36)}`;
}

export function defaultLayout(): DockLayout {
  return [
    { id: newGroupId(), tabs: ["properties"], active: "properties", flex: 1.3 },
    {
      id: newGroupId(),
      tabs: ["layers", "symbols", "swatches", "artboards", "generators"],
      active: "layers",
      flex: 1,
    },
  ];
}

/** Reassign a group's active tab after `removed` leaves; keeps focus nearby. */
function activeAfterRemoval(tabs: string[], active: string, removed: string): string {
  if (active !== removed) return active;
  const i = tabs.indexOf(removed);
  const rest = tabs.filter((t) => t !== removed);
  if (rest.length === 0) return "";
  return rest[Math.min(i, rest.length - 1)] ?? rest[0];
}

function clone(layout: DockLayout): DockLayout {
  return layout.map((g) => ({ ...g, tabs: [...g.tabs] }));
}

/** Drop `panelId` at `target`, moving it out of wherever it currently lives. */
export function placeTab(
  layout: DockLayout,
  panelId: string,
  target: DropTarget
): DockLayout {
  let groups = clone(layout);

  // Remove the panel from its current group (it may be re-added below), noting
  // where it came from so a same-group reorder can correct for the shift.
  const src = groups.find((g) => g.tabs.includes(panelId));
  const srcId = src?.id;
  const srcIndex = src ? src.tabs.indexOf(panelId) : -1;
  if (src) {
    src.active = activeAfterRemoval(src.tabs, src.active, panelId);
    src.tabs = src.tabs.filter((t) => t !== panelId);
  }

  if (target.kind === "tab") {
    const g = groups.find((gr) => gr.id === target.groupId);
    if (!g) return layout;
    let index = target.index;
    // Dropping past the tab's own old slot in the same group shifts left by one.
    if (g.id === srcId && srcIndex >= 0 && srcIndex < index) index -= 1;
    index = Math.max(0, Math.min(index, g.tabs.length));
    g.tabs.splice(index, 0, panelId);
    g.active = panelId;
  } else {
    // Keep the new group in the same flex unit as the existing layout. Divider
    // resizing stores pixel-sized weights, so a fixed value such as `1` would
    // make a later split almost invisible. A real split shares the source
    // group's height; moving its only tab preserves that group's full height.
    let splitFlex = src?.flex ?? 1;
    if (src && src.tabs.length > 0) {
      splitFlex = src.flex / 2;
      src.flex -= splitFlex;
    }
    const at =
      target.beforeGroupId === null
        ? groups.length
        : groups.findIndex((g) => g.id === target.beforeGroupId);
    const insertAt = at < 0 ? groups.length : at;
    groups.splice(insertAt, 0, {
      id: newGroupId(),
      tabs: [panelId],
      active: panelId,
      flex: splitFlex,
    });
  }

  // Drop any group left empty by the move (never the one we just filled).
  groups = groups.filter((g) => g.tabs.length > 0);
  return groups;
}

export function setActiveTab(
  layout: DockLayout,
  groupId: string,
  panelId: string
): DockLayout {
  return layout.map((g) =>
    g.id === groupId && g.tabs.includes(panelId) ? { ...g, active: panelId } : g
  );
}

/** Remove a tab; empty groups collapse. */
export function closeTab(layout: DockLayout, panelId: string): DockLayout {
  return clone(layout)
    .map((g) => {
      if (!g.tabs.includes(panelId)) return g;
      g.active = activeAfterRemoval(g.tabs, g.active, panelId);
      g.tabs = g.tabs.filter((t) => t !== panelId);
      return g;
    })
    .filter((g) => g.tabs.length > 0);
}

/** Add a panel (or focus it if already open). New panels join the last group. */
export function addTab(
  layout: DockLayout,
  panelId: string,
  groupId?: string
): DockLayout {
  if (layout.some((g) => g.tabs.includes(panelId))) {
    return layout.map((g) =>
      g.tabs.includes(panelId) ? { ...g, active: panelId } : g
    );
  }
  if (layout.length === 0) {
    return [{ id: newGroupId(), tabs: [panelId], active: panelId, flex: 1 }];
  }
  const targetId = groupId ?? layout[layout.length - 1].id;
  return layout.map((g) =>
    g.id === targetId
      ? { ...g, tabs: [...g.tabs, panelId], active: panelId }
      : g
  );
}

/** Panel ids not currently placed anywhere, given the known registry order. */
export function hiddenPanels(layout: DockLayout, allIds: string[]): string[] {
  const shown = new Set(layout.flatMap((g) => g.tabs));
  return allIds.filter((id) => !shown.has(id));
}

/**
 * Load a saved layout, discarding tabs whose panels no longer exist. Falls back
 * to the default when nothing valid remains.
 */
export function loadLayout(validIds: string[]): DockLayout {
  const valid = new Set(validIds);
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultLayout();
    const parsed = JSON.parse(raw) as DockLayout;
    if (!Array.isArray(parsed)) return defaultLayout();
    const groups: DockLayout = [];
    for (const g of parsed) {
      const tabs = Array.isArray(g?.tabs)
        ? g.tabs.filter((t: unknown) => typeof t === "string" && valid.has(t))
        : [];
      if (tabs.length === 0) continue;
      const active = tabs.includes(g.active) ? g.active : tabs[0];
      const flex = typeof g.flex === "number" && g.flex > 0 ? g.flex : 1;
      groups.push({ id: typeof g.id === "string" ? g.id : newGroupId(), tabs, active, flex });
    }
    return groups.length > 0 ? groups : defaultLayout();
  } catch {
    return defaultLayout();
  }
}

export function saveLayout(layout: DockLayout): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Ignore quota / private-mode failures — layout is a convenience.
  }
}
