import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { CustomerReportPage } from "./components/CustomerReportPage";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles/global.css";

const root = document.getElementById("root");
if (!root) throw new Error("Root element #root not found.");

// No router library (project convention - see CLAUDE.md) - /report/:id is
// the one public, no-login URL this app serves, so a single path check
// here is enough. nginx's `try_files $uri /index.html;` already sends any
// unknown path to this same index.html, so no server config change was
// needed to support it.
const reportMatch = window.location.pathname.match(/^\/report\/([^/]+)\/?$/);

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ErrorBoundary>
      {reportMatch ? <CustomerReportPage scoringId={decodeURIComponent(reportMatch[1]!)} /> : <App />}
    </ErrorBoundary>
  </React.StrictMode>,
);
