import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { restoreRecoveryAtStartup } from "./io/recovery";
import "./index.css";

async function main() {
  // Recovery is resolved before the first paint so the user never sees an
  // empty document flash before their work is restored.
  await restoreRecoveryAtStartup();
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

void main();
