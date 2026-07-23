import { useMenu } from "../store/menuStore";
import { ContextMenu } from "./menu/Menu";

/** Renders the app-wide context menu; mount once at the App root. */
export default function ContextMenuHost() {
  const menu = useMenu((s) => s.menu);
  const closeMenu = useMenu((s) => s.closeMenu);
  if (!menu) return null;
  return (
    <ContextMenu
      key={`${menu.x},${menu.y}`}
      x={menu.x}
      y={menu.y}
      entries={menu.entries}
      onClose={closeMenu}
    />
  );
}
