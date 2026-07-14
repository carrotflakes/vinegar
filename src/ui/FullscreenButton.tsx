import { useEffect, useState } from "react";
import { LuMaximize, LuMinimize } from "react-icons/lu";
import { runCommand } from "../commands/registry";
import { isFullscreen } from "./fullscreen";
import { barButton } from "./AppBar.css";

/** Header toggle that mirrors the browser's fullscreen state. */
export default function FullscreenButton() {
  const [full, setFull] = useState(isFullscreen);

  useEffect(() => {
    const onChange = () => setFull(isFullscreen());
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, []);

  return (
    <button
      className={barButton({ icon: true })}
      onClick={() => runCommand("view.fullscreen")}
      aria-pressed={full}
      title={full ? "Exit fullscreen" : "Enter fullscreen"}
    >
      {full ? <LuMinimize aria-hidden /> : <LuMaximize aria-hidden />}
    </button>
  );
}
