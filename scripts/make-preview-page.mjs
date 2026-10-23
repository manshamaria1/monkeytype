// Turns `vite build --mode preview` output into one self-contained HTML page
// (all JS and CSS inline) that can be opened or hosted without a server.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// usage: node scripts/make-preview-page.mjs <output.html> [build dir, default dist/preview]
const out = process.argv[2] ?? "dist/monkeytype-preview.html";
const dir = process.argv[3] ?? "dist/preview";
const html = readFileSync(`${dir}/index.html`, "utf8");
const js = html.match(/<script type="module" crossorigin src="\.?\/?([^"]+)"><\/script>/);
const css = html.match(/<link rel="stylesheet" crossorigin href="\.?\/?([^"]+)">/);
if (!js || !css) throw new Error("unexpected build output");
const code = readFileSync(`${dir}/` + js[1], "utf8").replace(/<\/script/gi, "<\\/script");
const style = readFileSync(`${dir}/` + css[1], "utf8");
const page = `<title>${process.env.PAGE_TITLE ?? "Monkeytype"}</title>
<meta name="theme-color" content="#323437">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@400;500&display=swap">
<style>${style}</style>
<div id="root"></div>
<script type="module">${code}</script>
`;
// FULL_HTML=1 adds the document skeleton, for hosting the file anywhere (GitHub Pages, any web host).
const full = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${page.replace(/<div id="root"><\/div>[\s\S]*$/, "")}</head>
<body>
<div id="root"></div>
<script type="module">${code}</script>
</body>
</html>
`;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, process.env.FULL_HTML === "1" ? full : page);
console.log(`${out}: ${(page.length / 1024).toFixed(0)} KB`);
