import React from "react";
import ReactDOM from "react-dom/client";
import { DisplaySettingsProvider } from "./theme/DisplaySettingsProvider";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <DisplaySettingsProvider>
      <App />
    </DisplaySettingsProvider>
  </React.StrictMode>,
);
