// ===========================================================================
// Floating-UI based menu system. Renders the shared `MenuEntry[]` data model
// (see store/menuStore.ts) for both the context menu (opened imperatively at a
// point) and the AppBar File dropdown. Floating UI provides the behaviour we
// used to hand-roll: viewport-aware positioning (flip/shift), keyboard list
// navigation + typeahead, touch-friendly dismissal, focus management and
// nested-submenu coordination.
// ===========================================================================

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { LuChevronRight } from "react-icons/lu";
import {
  autoUpdate,
  flip,
  FloatingFocusManager,
  FloatingList,
  FloatingNode,
  FloatingPortal,
  FloatingTree,
  offset,
  safePolygon,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useFloatingNodeId,
  useFloatingTree,
  useHover,
  useInteractions,
  useListItem,
  useListNavigation,
  useMergeRefs,
  useRole,
  useTypeahead,
  type Placement,
} from "@floating-ui/react";
import {
  isSubmenu,
  setDropdownOpen,
  type MenuEntry,
  type MenuItem,
  type MenuSubmenu,
} from "../../store/menuStore";
import "../ContextMenu.css";

// --- Shared context for one menu level ------------------------------------

interface MenuContextValue {
  getItemProps: (
    userProps?: React.HTMLProps<HTMLElement>
  ) => Record<string, unknown>;
  activeIndex: number | null;
  setHasFocusInside: (value: boolean) => void;
}

const MenuContext = createContext<MenuContextValue>({
  getItemProps: () => ({}),
  activeIndex: null,
  setHasFocusInside: () => {},
});

// --- Leaf item -------------------------------------------------------------

function MenuItemRow({ entry }: { entry: MenuItem }) {
  const menu = useContext(MenuContext);
  const tree = useFloatingTree();
  const item = useListItem({ label: entry.disabled ? null : entry.label });
  const isActive = item.index === menu.activeIndex;
  return (
    <button
      ref={item.ref}
      role="menuitem"
      className={"context-menu-item" + (entry.danger ? " danger" : "")}
      tabIndex={isActive ? 0 : -1}
      disabled={entry.disabled}
      {...menu.getItemProps({
        onClick() {
          entry.onSelect();
          tree?.events.emit("click");
        },
        onFocus() {
          menu.setHasFocusInside(true);
        },
      })}
    >
      <span className="context-menu-label">{entry.label}</span>
      {entry.shortcut && (
        <span className="context-menu-shortcut">{entry.shortcut}</span>
      )}
    </button>
  );
}

// --- Nested submenu --------------------------------------------------------

function SubMenu({ entry }: { entry: MenuSubmenu }) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const elementsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const labelsRef = useRef<Array<string | null>>([]);
  const parent = useContext(MenuContext);
  const tree = useFloatingTree();
  const nodeId = useFloatingNodeId();
  const item = useListItem({ label: entry.disabled ? null : entry.label });

  const { floatingStyles, refs, context } = useFloating<HTMLButtonElement>({
    nodeId,
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: "right-start",
    middleware: [
      offset({ mainAxis: 4, alignmentAxis: -5 }),
      flip(),
      shift({ padding: 8 }),
    ],
    whileElementsMounted: autoUpdate,
  });

  const hover = useHover(context, {
    enabled: !entry.disabled,
    delay: { open: 75 },
    handleClose: safePolygon({ blockPointerEvents: true }),
  });
  const click = useClick(context, { event: "mousedown", ignoreMouse: false });
  const role = useRole(context, { role: "menu" });
  const dismiss = useDismiss(context, { bubbles: true });
  const listNav = useListNavigation(context, {
    listRef: elementsRef,
    activeIndex,
    nested: true,
    onNavigate: setActiveIndex,
  });
  const typeahead = useTypeahead(context, {
    listRef: labelsRef,
    onMatch: isOpen ? setActiveIndex : undefined,
    activeIndex,
  });

  const { getReferenceProps, getFloatingProps, getItemProps } = useInteractions([
    hover,
    click,
    role,
    dismiss,
    listNav,
    typeahead,
  ]);

  // Close this submenu whenever any item in the tree is chosen.
  useEffect(() => {
    if (!tree) return;
    const onClick = () => setIsOpen(false);
    tree.events.on("click", onClick);
    return () => tree.events.off("click", onClick);
  }, [tree]);

  const isActive = item.index === parent.activeIndex;

  return (
    <FloatingNode id={nodeId}>
      <button
        ref={useMergeRefs([refs.setReference, item.ref])}
        role="menuitem"
        className="context-menu-item"
        tabIndex={isActive ? 0 : -1}
        disabled={entry.disabled}
        {...getReferenceProps(
          parent.getItemProps({
            onFocus() {
              parent.setHasFocusInside(true);
            },
          })
        )}
      >
        <span className="context-menu-label">{entry.label}</span>
        <LuChevronRight className="context-menu-caret" aria-hidden />
      </button>
      <MenuContext.Provider
        value={{ activeIndex, getItemProps, setHasFocusInside: () => {} }}
      >
        <FloatingList elementsRef={elementsRef} labelsRef={labelsRef}>
          {isOpen && (
            <FloatingPortal>
              <FloatingFocusManager
                context={context}
                modal={false}
                initialFocus={-1}
                returnFocus
              >
                <div
                  ref={refs.setFloating}
                  className="context-menu"
                  style={floatingStyles}
                  {...getFloatingProps()}
                >
                  <MenuContents entries={entry.submenu} />
                </div>
              </FloatingFocusManager>
            </FloatingPortal>
          )}
        </FloatingList>
      </MenuContext.Provider>
    </FloatingNode>
  );
}

// --- Entry list mapper -----------------------------------------------------

function MenuContents({ entries }: { entries: MenuEntry[] }) {
  return (
    <>
      {entries.map((entry, i) =>
        entry === "separator" ? (
          <div key={i} className="context-menu-sep" />
        ) : isSubmenu(entry) ? (
          <SubMenu key={i} entry={entry} />
        ) : (
          <MenuItemRow key={i} entry={entry} />
        )
      )}
    </>
  );
}

// --- Root popup (shared by both root menus) --------------------------------

function RootPopup({
  entries,
  context,
  setFloating,
  floatingStyles,
  getFloatingProps,
  getItemProps,
  activeIndex,
  elementsRef,
  labelsRef,
}: {
  entries: MenuEntry[];
  context: ReturnType<typeof useFloating>["context"];
  setFloating: (node: HTMLElement | null) => void;
  floatingStyles: React.CSSProperties;
  getFloatingProps: (
    userProps?: React.HTMLProps<HTMLElement>
  ) => Record<string, unknown>;
  getItemProps: MenuContextValue["getItemProps"];
  activeIndex: number | null;
  elementsRef: React.MutableRefObject<Array<HTMLButtonElement | null>>;
  labelsRef: React.MutableRefObject<Array<string | null>>;
}) {
  return (
    <MenuContext.Provider
      value={{ getItemProps, activeIndex, setHasFocusInside: () => {} }}
    >
      <FloatingList elementsRef={elementsRef} labelsRef={labelsRef}>
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false} initialFocus={0}>
            <div
              ref={setFloating}
              className="context-menu"
              style={floatingStyles}
              onContextMenu={(e) => e.preventDefault()}
              {...getFloatingProps()}
            >
              <MenuContents entries={entries} />
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      </FloatingList>
    </MenuContext.Provider>
  );
}

// --- Context menu (imperative, positioned at a point) ----------------------

function ContextMenuInner({
  x,
  y,
  entries,
  onClose,
}: {
  x: number;
  y: number;
  entries: MenuEntry[];
  onClose: () => void;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const elementsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const labelsRef = useRef<Array<string | null>>([]);
  const tree = useFloatingTree();
  const nodeId = useFloatingNodeId();

  const { refs, floatingStyles, context } = useFloating({
    nodeId,
    open: true,
    onOpenChange: (open) => {
      if (!open) onClose();
    },
    placement: "right-start",
    middleware: [flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  // Anchor to the click point via a zero-size virtual reference.
  useEffect(() => {
    refs.setPositionReference({
      getBoundingClientRect: () => ({
        width: 0,
        height: 0,
        x,
        y,
        top: y,
        left: x,
        right: x,
        bottom: y,
      }),
    });
  }, [x, y, refs]);

  const role = useRole(context, { role: "menu" });
  const dismiss = useDismiss(context, { bubbles: true });
  const listNav = useListNavigation(context, {
    listRef: elementsRef,
    activeIndex,
    onNavigate: setActiveIndex,
  });
  const typeahead = useTypeahead(context, {
    listRef: labelsRef,
    activeIndex,
    onMatch: setActiveIndex,
  });
  const { getFloatingProps, getItemProps } = useInteractions([
    role,
    dismiss,
    listNav,
    typeahead,
  ]);

  useEffect(() => {
    if (!tree) return;
    tree.events.on("click", onClose);
    return () => tree.events.off("click", onClose);
  }, [tree, onClose]);

  return (
    <FloatingNode id={nodeId}>
      <RootPopup
        entries={entries}
        context={context}
        setFloating={refs.setFloating}
        floatingStyles={floatingStyles}
        getFloatingProps={getFloatingProps}
        getItemProps={getItemProps}
        activeIndex={activeIndex}
        elementsRef={elementsRef}
        labelsRef={labelsRef}
      />
    </FloatingNode>
  );
}

/** Context menu positioned at a screen point. Wrap once per open menu. */
export function ContextMenu(props: {
  x: number;
  y: number;
  entries: MenuEntry[];
  onClose: () => void;
}) {
  return (
    <FloatingTree>
      <ContextMenuInner {...props} />
    </FloatingTree>
  );
}

// --- Dropdown menu (anchored to a trigger, e.g. the File button) -----------

function DropdownMenuInner({
  entries,
  placement,
  renderTrigger,
}: {
  entries: MenuEntry[];
  placement: Placement;
  renderTrigger: (p: {
    ref: (node: HTMLElement | null) => void;
    open: boolean;
    props: Record<string, unknown>;
  }) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const elementsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const labelsRef = useRef<Array<string | null>>([]);
  const tree = useFloatingTree();
  const nodeId = useFloatingNodeId();

  const { refs, floatingStyles, context } = useFloating({
    nodeId,
    open,
    onOpenChange: setOpen,
    placement,
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  const click = useClick(context, { event: "mousedown" });
  const role = useRole(context, { role: "menu" });
  const dismiss = useDismiss(context, { bubbles: true });
  const listNav = useListNavigation(context, {
    listRef: elementsRef,
    activeIndex,
    onNavigate: setActiveIndex,
  });
  const typeahead = useTypeahead(context, {
    listRef: labelsRef,
    activeIndex,
    onMatch: open ? setActiveIndex : undefined,
  });
  const { getReferenceProps, getFloatingProps, getItemProps } = useInteractions([
    click,
    role,
    dismiss,
    listNav,
    typeahead,
  ]);

  // Track open state so the app's global Escape handler yields to the menu.
  useEffect(() => {
    if (!open) return;
    setDropdownOpen(true);
    return () => setDropdownOpen(false);
  }, [open]);

  useEffect(() => {
    if (!tree) return;
    const close = () => setOpen(false);
    tree.events.on("click", close);
    return () => tree.events.off("click", close);
  }, [tree]);

  return (
    <FloatingNode id={nodeId}>
      {renderTrigger({ ref: refs.setReference, open, props: getReferenceProps() })}
      {open && (
        <RootPopup
          entries={entries}
          context={context}
          setFloating={refs.setFloating}
          floatingStyles={floatingStyles}
          getFloatingProps={getFloatingProps}
          getItemProps={getItemProps}
          activeIndex={activeIndex}
          elementsRef={elementsRef}
          labelsRef={labelsRef}
        />
      )}
    </FloatingNode>
  );
}

/** Dropdown menu anchored to a trigger element rendered via `renderTrigger`. */
export function DropdownMenu({
  entries,
  placement = "bottom-start",
  renderTrigger,
}: {
  entries: MenuEntry[];
  placement?: Placement;
  renderTrigger: (p: {
    ref: (node: HTMLElement | null) => void;
    open: boolean;
    props: Record<string, unknown>;
  }) => ReactNode;
}) {
  return (
    <FloatingTree>
      <DropdownMenuInner
        entries={entries}
        placement={placement}
        renderTrigger={renderTrigger}
      />
    </FloatingTree>
  );
}
