import React from "react";
import { createRoot } from "react-dom/client";
import { ConsoleApp } from "./console/ConsoleApp";
import { createRuntime } from "./console/data/runtime";
import "./console/styles.css";
const root = createRoot(document.getElementById("root")!);
if (location.pathname === "/console" || location.pathname === "/console/") {
  void createRuntime(import.meta.env).then(runtime => root.render(<>
    {runtime.fixture && <p className="fixture-notice">Fixture preview · Changes stay in this browser session.</p>}
    <ConsoleApp {...runtime} />
  </>)).catch((error: unknown) => root.render(<main className="paper config-error"><h1>Console setup</h1><p role="alert">{error instanceof Error ? error.message : "Could not open Console."}</p></main>));
} else {
  root.render(<main className="paper config-error"><p>The storefront is served by the Shopify theme.</p></main>);
}
