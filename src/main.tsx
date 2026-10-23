import { createRoot } from "react-dom/client";
import App from "./App";
import ToolApp from "./ToolApp";
import { TOOL } from "./lib/preview";
import "./styles.css";

createRoot(document.getElementById("root")!).render(TOOL ? <ToolApp /> : <App />);
