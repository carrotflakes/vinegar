// ===========================================================================
// Experimental: a toolbar flyout that drops a built-in parametric generator
// onto the canvas in one gesture. Click a tile to insert it at the canvas
// centre, or drag the tile onto the canvas to place it where you release —
// the same click/drag pair the Symbols and Generators panels use. The inserted
// node keeps its generator link, so its parameters stay tunable in the
// properties panel afterwards.
//
// Marked experimental in the UI: the tile set and the placement gesture are
// still up for revision, and document scripts are deliberately absent (they
// live in the Generators panel, behind the trust gate).
// ===========================================================================

import { useRef } from "react";
import { LuShapes } from "react-icons/lu";
import { canvasCenterPlacement } from "../canvas/canvasDrag";
import { defaultArgs, GENERATORS } from "@/model/generators/generators";
import type { PathSubpath } from "../model/types";
import { useEditor } from "../store/editorStore";
import { drawGeometryPreview } from "./dialogs/generatorPreview";
import { Popover } from "./menu/Popover";
import { usePanelCanvasDrag } from "./usePanelCanvasDrag";
import "./menus.css";
import "./GeneratorFlyout.css";

interface Tile {
  id: string;
  name: string;
  subpaths: PathSubpath[];
}

// Built-ins are pure and synchronous, so every tile's default geometry can be
// built once at module load and reused for the thumbnails.
const TILES: Tile[] = Object.values(GENERATORS).map((gen) => ({
  id: gen.id,
  name: gen.name,
  subpaths: gen.build(defaultArgs(gen)),
}));

export default function GeneratorFlyout() {
  const insertGenerator = useEditor((s) => s.insertGenerator);
  // The popover's own dismiss handle, captured while its panel renders, so a
  // drop that lands on the canvas can close the flyout behind it.
  const closeRef = useRef<() => void>(() => {});

  const startDrag = usePanelCanvasDrag<string>({
    ghost: (id) => ({ label: GENERATORS[id]?.name ?? "Generator" }),
    onDrop: (id, { at }) => {
      void insertGenerator(id, at);
      closeRef.current();
    },
  });

  return (
    <Popover
      placement="right-start"
      className="gen-flyout-popover"
      renderTrigger={({ ref, open, props }) => (
        <button
          ref={ref}
          className={"tool-btn gen-flyout-trigger" + (open ? " active" : "")}
          title="Insert generator shape (experimental)"
          aria-label="Insert generator shape"
          aria-haspopup="dialog"
          aria-expanded={open}
          {...props}
        >
          <span className="tool-icon" aria-hidden>
            <LuShapes />
          </span>
        </button>
      )}
    >
      {(close) => {
        closeRef.current = close;
        return (
          <>
            <div className="gen-flyout-head">
              Generators
              <span className="gen-flyout-badge">Experimental</span>
            </div>
            <div className="gen-flyout-grid">
              {TILES.map((tile) => (
                <button
                  key={tile.id}
                  className="gen-flyout-item"
                  title={`Insert ${tile.name} — drag onto the canvas to place it`}
                  onPointerDown={(e) => startDrag(e, tile.id)}
                  onClick={() => {
                    void insertGenerator(tile.id, canvasCenterPlacement().at);
                    close();
                  }}
                >
                  <canvas
                    className="gen-flyout-thumb"
                    ref={(el) => {
                      drawGeometryPreview(el, tile.subpaths, {
                        grid: false,
                        pad: 5,
                      });
                    }}
                  />
                  <span className="gen-flyout-name">{tile.name}</span>
                </button>
              ))}
            </div>
            <div className="gen-flyout-hint">
              Drag a shape onto the canvas to place it there.
            </div>
          </>
        );
      }}
    </Popover>
  );
}
