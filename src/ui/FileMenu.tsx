import { LuChevronDown } from "react-icons/lu";
import { barButton } from "./AppBar.css";
import { DropdownMenu } from "./menu/Menu";
import { fileMenu } from "./menus";
import "./menus.css"; // .menu-caret for the trigger button

/**
 * The AppBar File dropdown. Content comes from the shared `fileMenu()` builder
 * and is drawn by the same Floating UI menu as the context menu; this component
 * only provides the trigger button.
 */
export default function FileMenu() {
  return (
    <DropdownMenu
      entries={fileMenu()}
      renderTrigger={({ ref, open, props }) => (
        <button
          ref={ref}
          className={barButton({ active: open })}
          aria-haspopup="menu"
          aria-expanded={open}
          {...props}
        >
          File <LuChevronDown className="menu-caret" aria-hidden />
        </button>
      )}
    />
  );
}
