import { useEffect, useState } from "react";
import { LuChevronDown, LuRotateCcwSquare, LuRotateCwSquare } from "react-icons/lu";
import ScrubbableNumber from "./controls/ScrubbableNumber";
import {
  canvasCenter,
  commandEnabled,
  commandShortcut,
  getCommand,
  runCommand,
} from "../commands/registry";
import { rotateAt } from "@/model/geometry/viewport";
import { useEditor } from "../store/editorStore";
import { usePreferences } from "../store/preferencesStore";
import { barButton } from "./AppBar.css";
import { Popover } from "./menu/Popover";
import "./menus.css";

const ITEMS = [
  "view.reset",
  "view.flipHorizontal",
  "view.fitSelection",
  "view.fitAll",
  "view.fitFrame",
];

/** Normalize radians to the (-180, 180] degrees shown in the readout. */
function rotationDegrees(rotation: number): number {
  const deg = Math.round((rotation * 180) / Math.PI);
  return ((((deg + 180) % 360) + 360) % 360) - 180;
}

/** Zoom/rotation readout plus discoverable reset/fit navigation actions. */
export default function ZoomMenu() {
  const scale = useEditor((s) => s.viewport.scale);
  const angle = useEditor((s) => rotationDegrees(s.viewport.rotation));
  const rotationEnabled = usePreferences((s) => s.canvas.rotationEnabled);

  return (
    <div className="menu-root">
      <Popover
        placement="bottom-end"
        className="zoom-menu-popover"
        renderTrigger={({ ref, open, props }) => (
          <button
            ref={ref}
            className={`${barButton({ active: open })} zoom-readout zoom-menu-trigger`}
            title="Zoom and fit options"
            aria-label={`Zoom ${Math.round(scale * 100)}%${
              angle !== 0 ? `, rotated ${angle} degrees` : ""
            }. Open zoom and fit options`}
            aria-haspopup="menu"
            aria-expanded={open}
            {...props}
          >
            <span>{Math.round(scale * 100)}%</span>
            {rotationEnabled && (
              <svg
                className={`zoom-menu-knob${angle !== 0 ? " is-rotated" : ""}`}
                width="14"
                height="14"
                viewBox="0 0 14 14"
                aria-hidden
              >
                <circle cx="7" cy="7" r="5.5" />
                <line
                  x1="7"
                  y1="7"
                  x2="7"
                  y2="2"
                  transform={`rotate(${angle} 7 7)`}
                />
              </svg>
            )}
            <LuChevronDown className="menu-caret" aria-hidden />
          </button>
        )}
      >
        {(close) => <ZoomMenuPanel close={close} />}
      </Popover>
    </div>
  );
}

/** Popover body — mounted only while open, so it can subscribe to live command
 * enablement without re-rendering the readout trigger on every edit. */
function ZoomMenuPanel({ close }: { close: () => void }) {
  const state = useEditor((s) => s);
  const angle = rotationDegrees(state.viewport.rotation);
  const rotationEnabled = usePreferences((s) => s.canvas.rotationEnabled);

  // The field's own value, kept separate from the normalized store angle so
  // scrubbing to 180 doesn't flip the readout to the equivalent -180. It follows
  // external rotation (gestures, the ±90 buttons) but only when they change the
  // actual rotation.
  const [fieldAngle, setFieldAngle] = useState(angle);
  useEffect(() => {
    setFieldAngle((prev) => ((prev - angle) % 360 === 0 ? prev : angle));
  }, [angle]);

  const rotateBy = (deltaDeg: number) => {
    const viewport = useEditor.getState().viewport;
    state.setViewport(rotateAt(viewport, canvasCenter(), (deltaDeg * Math.PI) / 180));
  };

  // Rotate the canvas about its center to an absolute angle (degrees). The delta
  // is measured from the field's own value so scrubbing stays continuous across
  // the ±180 wrap.
  const rotateTo = (deg: number) => {
    setFieldAngle(deg);
    rotateBy(deg - fieldAngle);
  };

  return (
    <>
      {rotationEnabled && (
        <div className="zoom-menu-rotation">
          <span className="zoom-menu-rotation-label">Rotate</span>
          <span className="zoom-menu-rotation-field">
            <ScrubbableNumber
              value={fieldAngle}
              min={-180}
              max={180}
              aria-label="Canvas rotation"
              onChange={rotateTo}
            />
            <span className="zoom-menu-rotation-unit" aria-hidden>
              °
            </span>
          </span>
          <button
            className="zoom-menu-rotation-step"
            title="Rotate 90° counter-clockwise"
            aria-label="Rotate 90 degrees counter-clockwise"
            onClick={() => rotateBy(-90)}
          >
            <LuRotateCcwSquare aria-hidden />
          </button>
          <button
            className="zoom-menu-rotation-step"
            title="Rotate 90° clockwise"
            aria-label="Rotate 90 degrees clockwise"
            onClick={() => rotateBy(90)}
          >
            <LuRotateCwSquare aria-hidden />
          </button>
          <button
            className="zoom-menu-rotation-reset"
            title="Reset rotation"
            aria-label="Reset rotation"
            disabled={fieldAngle === 0}
            onClick={() => rotateTo(0)}
          >
            0°
          </button>
        </div>
      )}
      {ITEMS.map((id) => {
        const command = getCommand(id);
        if (!command) return null;
        const enabled = commandEnabled(command, state);
        const shortcut = commandShortcut(command);
        return (
          <button
            key={id}
            role="menuitem"
            className="menu-item zoom-menu-item"
            disabled={!enabled}
            onClick={() => {
              close();
              runCommand(id);
            }}
          >
            <span>{command.label}</span>
            {shortcut && <span className="menu-shortcut">{shortcut}</span>}
          </button>
        );
      })}
    </>
  );
}
