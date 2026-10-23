// Turns `vite build --mode preview` output into one self-contained HTML page
// (all JS and CSS inline) that can be opened or hosted without a server.
import { readFileSync, writeFileSync } from "node:fs";

const out = process.argv[2] ?? "dist/monkeytype-preview.html";
const html = readFileSync("dist/preview/index.html", "utf8");
const js = html.match(/<script type="module" crossorigin src="\.?\/?([^"]+)"><\/script>/);
const css = html.match(/<link rel="stylesheet" crossorigin href="\.?\/?([^"]+)">/);
if (!js || !css) throw new Error("unexpected build output");
const code = readFileSync("dist/preview/" + js[1], "utf8").replace(/<\/script/gi, "<\\/script");
const style = readFileSync("dist/preview/" + css[1], "utf8");
const page = `<title>Monkeytype</title>
<meta name="theme-color" content="#323437">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@400;500&display=swap">
<style>${style}</style>
<div id="root"></div>
<script type="module">${code}</script>
`;
writeFileSync(out, page);
console.log(`${out}: ${(page.length / 1024).toFixed(0)} KB`);
