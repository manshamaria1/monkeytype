import { createRoot } from "react-dom/client";
import App from "./App";
import ToolApp from "./ToolApp";
import { TOOL } from "./lib/preview";
import { WP, WP_BUILD } from "./lib/wp";
import "./styles.css";

// WordPress: mount into the box the [typing_test] shortcode printed.
const container = document.getElementById(WP_BUILD ? "typing-test-root" : "root");
if (container) createRoot(container).render(TOOL || WP?.view === "test" ? <ToolApp /> : <App />);
