import Dock from "./dock/Dock";
import "./RightSidebar.css";

/**
 * Right sidebar. The contents are a tabbed dock (see `dock/Dock`): a column of
 * tab groups whose panels stack as tabs, so the sidebar's width stays fixed no
 * matter how many panels are open. The wrapper only handles show/hide.
 */
export default function RightSidebar({ open = false }: { open?: boolean }) {
  return (
    <div className={"right" + (open ? " open" : "")}>
      <Dock />
    </div>
  );
}
