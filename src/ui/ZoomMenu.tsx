import { useEffect, useState } from "react";
import {
  LuChevronDown,
  LuFlipHorizontal2,
  LuFlipVertical2,
  LuMinus,
  LuPlus,
  LuRotateCcwSquare,
  LuRotateCwSquare,
} from "react-icons/lu";
import ScrubbableNumber from "./controls/ScrubbableNumber";
import {
  canvasCenter,
  commandEnabled,
  commandShortcut,
  getCommand,
  runCommand,
} from "../commands/registry";
import { clampScale, rotateAt, zoomAt } from "@/model/geometry/viewport";
import { useEditor } from "../store/editorStore";
import { usePreferences } from "../store/preferencesStore";
import { barButton } from "./AppBar.css";
import { Popover } from "./menu/Popover";
import "./menus.css";

const ITEMS = [
  "view.reset",
  "view.fitSelection",
  "view.fitAll",
  "view.fitFrame",
];

/** Normalize radians to the (-180, 180] degrees shown in the readout. */
function rotationDegrees(rotation: number): number {
  const deg = Math.round((rotation * 180) / Math.PI);
  return ((((deg + 180) % 360) + 360) % 360) - 180;
}

const zoomPercent = (scale: number) => Math.round(scale * 100);

/** Title text for a command, with its shortcut appended when it has one. */
function commandTitle(id: string, fallback: string): string {
  const command = getCommand(id);
  const shortcut = command ? commandShortcut(command) : null;
  const label = command?.label ?? fallback;
  return shortcut ? `${label} (${shortcut})` : label;
}

/** Zoom/rotation readout plus discoverable reset/fit navigation actions. */
export default function ZoomMenu() {
  const scale = useEditor((s) => s.viewport.scale);
  const angle = useEditor((s) => rotationDegrees(s.viewport.rotation));
  const mirrored = useEditor((s) => !!s.viewport.flipX);
  const rotationEnabled = usePreferences((s) => s.canvas.rotationEnabled);

  return (
    <div className="menu-root">
      <Popover
        placement="bottom-end"
        className="zoom-menu-popover"
        label="Zoom and fit options"
        renderTrigger={({ ref, open, props }) => (
          <button
            ref={ref}
            className={`${barButton({ active: open })} zoom-readout zoom-menu-trigger`}
            title="Zoom and fit options"
            aria-label={`Zoom ${zoomPercent(scale)}%${
              angle !== 0 ? `, rotated ${angle} degrees` : ""
            }${mirrored ? ", mirrored" : ""}. Open zoom and fit options`}
            aria-haspopup="dialog"
            aria-expanded={open}
            {...props}
          >
            <span>{zoomPercent(scale)}%</span>
            {/* Only shown while the view is mirrored: an easy state to forget
                you are in, and the readout alone cannot express it. */}
            {mirrored && <LuFlipHorizontal2 className="zoom-menu-mirror" aria-hidden />}
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
  const percent = zoomPercent(state.viewport.scale);
  const angle = rotationDegrees(state.viewport.rotation);
  const mirrored = !!state.viewport.flipX;
  const rotationEnabled = usePreferences((s) => s.canvas.rotationEnabled);

  // The field's own value, kept separate from the normalized store angle so
  // scrubbing to 180 doesn't flip the readout to the equivalent -180. It follows
  // external rotation (gestures, the ±90 buttons) but only when they change the
  // actual rotation.
  const [fieldAngle, setFieldAngle] = useState(angle);
  useEffect(() => {
    setFieldAngle((prev) => ((prev - angle) % 360 === 0 ? prev : angle));
  }, [angle]);

  // Zoom about the canvas centre, like the zoom in/out commands, so typing a
  // percentage keeps the same world point under the middle of the view.
  const zoomTo = (nextPercent: number) => {
    const viewport = useEditor.getState().viewport;
    const target = clampScale(nextPercent / 100);
    state.setViewport(zoomAt(viewport, canvasCenter(), target / viewport.scale));
  };

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
      <div className="zoom-menu-controls">
        <div className="zoom-menu-row">
          <span className="zoom-menu-row-label">Zoom</span>
          <span className="zoom-menu-field">
            <ScrubbableNumber
              value={percent}
              min={5}
              max={6400}
              scale="log"
              unit="%"
              defaultValue={100}
              aria-label="Zoom percentage"
              onChange={zoomTo}
            />
          </span>
          <button
            className="zoom-menu-step"
            title={commandTitle("view.zoomOut", "Zoom out")}
            aria-label="Zoom out"
            onClick={() => runCommand("view.zoomOut")}
          >
            <LuMinus aria-hidden />
          </button>
          <button
            className="zoom-menu-step"
            title={commandTitle("view.zoomIn", "Zoom in")}
            aria-label="Zoom in"
            onClick={() => runCommand("view.zoomIn")}
          >
            <LuPlus aria-hidden />
          </button>
          <button
            className="zoom-menu-reset"
            title="Zoom to 100%"
            aria-label="Zoom to 100 percent"
            disabled={percent === 100}
            onClick={() => zoomTo(100)}
          >
            1:1
          </button>
        </div>
        {rotationEnabled && (
          <div className="zoom-menu-row">
            <span className="zoom-menu-row-label">Rotate</span>
            <span className="zoom-menu-field">
              <ScrubbableNumber
                value={fieldAngle}
                min={-180}
                max={180}
                unit="°"
                defaultValue={0}
                aria-label="Canvas rotation"
                onChange={rotateTo}
              />
            </span>
            <button
              className="zoom-menu-step"
              title="Rotate 90° counter-clockwise"
              aria-label="Rotate 90 degrees counter-clockwise"
              onClick={() => rotateBy(-90)}
            >
              <LuRotateCcwSquare aria-hidden />
            </button>
            <button
              className="zoom-menu-step"
              title="Rotate 90° clockwise"
              aria-label="Rotate 90 degrees clockwise"
              onClick={() => rotateBy(90)}
            >
              <LuRotateCwSquare aria-hidden />
            </button>
            <button
              className="zoom-menu-reset"
              title="Reset rotation"
              aria-label="Reset rotation"
              disabled={fieldAngle === 0}
              onClick={() => rotateTo(0)}
            >
              0°
            </button>
          </div>
        )}
        <div className="zoom-menu-row">
          <span className="zoom-menu-row-label">Flip</span>
          <span className="zoom-menu-flip-group" role="group" aria-label="Flip view">
            <button
              className="zoom-menu-step"
              title={commandTitle("view.flipHorizontal", "Flip view horizontally")}
              aria-label="Flip view horizontally"
              onClick={() => runCommand("view.flipHorizontal")}
            >
              <LuFlipHorizontal2 aria-hidden />
            </button>
            <button
              className="zoom-menu-step"
              title={commandTitle("view.flipVertical", "Flip view vertically")}
              aria-label="Flip view vertically"
              onClick={() => runCommand("view.flipVertical")}
            >
              <LuFlipVertical2 aria-hidden />
            </button>
          </span>
          {/* Both flips share one mirror flag, so the state is "mirrored or
              not" rather than a per-axis toggle. */}
          {mirrored && <span className="zoom-menu-flag">Mirrored</span>}
        </div>
      </div>
      {ITEMS.map((id) => {
        const command = getCommand(id);
        if (!command) return null;
        const enabled = commandEnabled(command, state);
        const shortcut = commandShortcut(command);
        return (
          <button
            key={id}
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
