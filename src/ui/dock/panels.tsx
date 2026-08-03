import type { ReactNode } from "react";
import AssetsPanel from "../panels/assets/AssetsPanel";
import GeneratorsPanel from "../panels/generators/GeneratorsPanel";
import HistoryPanel from "../panels/history/HistoryPanel";
import LayersPanel from "../panels/layers/LayersPanel";
import PropertiesPanel from "../panels/properties/PropertiesPanel";
import SymbolsPanel from "../panels/symbols/SymbolsPanel";
import VarsPanel from "../panels/vars/VarsPanel";

/** A dockable panel: a stable id, a tab label, and how to render its body. */
export interface PanelDef {
  id: string;
  title: string;
  render: () => ReactNode;
}

/** Registry of every panel the dock can host. Order = the "add panel" menu. */
export const PANELS: PanelDef[] = [
  { id: "properties", title: "Properties", render: () => <PropertiesPanel /> },
  { id: "layers", title: "Layers", render: () => <LayersPanel /> },
  { id: "symbols", title: "Symbols", render: () => <SymbolsPanel /> },
  { id: "vars", title: "Variables", render: () => <VarsPanel /> },
  { id: "generators", title: "Generators", render: () => <GeneratorsPanel /> },
  { id: "assets", title: "Assets", render: () => <AssetsPanel /> },
  { id: "history", title: "History", render: () => <HistoryPanel /> },
];

export const PANEL_MAP: Record<string, PanelDef> = Object.fromEntries(
  PANELS.map((p) => [p.id, p])
);

export const PANEL_IDS = PANELS.map((p) => p.id);
