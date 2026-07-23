import { useEffect, useState } from "react";
import { LuChevronDown, LuRotateCcw } from "react-icons/lu";
import {
  canvasCenter,
  commandEnabled,
  commandShortcut,
  getCommand,
  runCommand,
} from "../commands/registry";
import { rotateAt } from "../model/viewport";
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
  "view.fitArtboard",
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

  // The slider's own position, kept separate from the normalized store angle so
  // dragging to 180 doesn't snap the thumb to the equivalent -180. It follows
  // external rotation (gestures) but only when they change the actual rotation.
  const [sliderAngle, setSliderAngle] = useState(angle);
  useEffect(() => {
    setSliderAngle((prev) => ((prev - angle) % 360 === 0 ? prev : angle));
  }, [angle]);

  // Rotate the canvas about its center to an absolute angle (degrees). The delta
  // is measured from the slider's own position so dragging stays continuous
  // across the ±180 wrap.
  const rotateTo = (deg: number) => {
    const delta = ((deg - sliderAngle) * Math.PI) / 180;
    setSliderAngle(deg);
    state.setViewport(rotateAt(useEditor.getState().viewport, canvasCenter(), delta));
  };

  return (
    <>
      {rotationEnabled && (
        <div className="zoom-menu-rotation">
          <span className="zoom-menu-rotation-label">Rotate</span>
          <input
            className="zoom-menu-rotation-slider"
            type="range"
            min={-180}
            max={180}
            step={1}
            value={sliderAngle}
            aria-label="Canvas rotation"
            onChange={(e) => rotateTo(Number(e.target.value))}
          />
          <span className="zoom-menu-rotation-value">{sliderAngle}°</span>
          <button
            className="zoom-menu-rotation-reset"
            title="Reset rotation"
            aria-label="Reset rotation"
            disabled={sliderAngle === 0}
            onClick={() => rotateTo(0)}
          >
            <LuRotateCcw aria-hidden />
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
