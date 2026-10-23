// Builds the WordPress plugin: app script + scoped stylesheet + data, zipped to dist/typing-test.zip.
// Run with `npm run build:wp`.
import { execSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const WP_OVERRIDES = `
.tt-root{background:var(--bg);color:var(--text);font-family:var(--ui-font);font-size:16px;line-height:1.5;border-radius:12px;padding:8px 20px 4px;text-align:left;box-sizing:border-box}
.tt-root .app{min-height:0;max-width:none;padding:0}
.tt-root .main{padding:8px 0 16px}
.tt-root .test-page{min-height:420px}
.tt-root .header{padding-top:8px}
.tt-root .nav{flex-wrap:wrap;margin-left:0}
.tt-root button,.tt-root input,.tt-root select,.tt-root textarea{text-transform:none;letter-spacing:normal;box-shadow:none;margin:0;min-height:0;line-height:normal;width:auto}
.tt-root .btn-block{width:100%}
.tt-root a{box-shadow:none}
.tt-root table{margin:0;border:0;border-collapse:collapse}
.tt-root td,.tt-root th{border:0}
.tt-root h1,.tt-root h2,.tt-root h3{font-family:var(--ui-font);color:var(--text);letter-spacing:normal;text-transform:none;line-height:1.3}
.tt-root ul,.tt-root ol{padding-left:22px;margin:0 0 12px}
.tt-root p{margin:0 0 12px}
.tt-root img{max-width:100%}
`;

const PLUGIN = "wordpress/typing-test";
const run = (cmd) => execSync(cmd, { stdio: "inherit" });

run("npx tsx scripts/export-wp-data.ts");
run("npx vite build --mode wordpress");

const html = readFileSync("dist/wordpress/index.html", "utf8");
const js = html.match(/<script[^>]*src="\.?\/?([^"]+\.js)"/);
const css = html.match(/<link rel="stylesheet"[^>]*href="\.?\/?([^"]+\.css)"/);
if (!js || !css) throw new Error("unexpected build output");
mkdirSync(`${PLUGIN}/assets`, { recursive: true });
copyFileSync(`dist/wordpress/${js[1]}`, `${PLUGIN}/assets/app.js`);
writeFileSync(`${PLUGIN}/assets/app.css`, scopeCss(readFileSync(`dist/wordpress/${css[1]}`, "utf8")) + WP_OVERRIDES);

rmSync("dist/typing-test.zip", { force: true });
run(`cd wordpress && zip -q -r ../dist/typing-test.zip typing-test -x "*.DS_Store"`);
console.log("WordPress plugin: dist/typing-test.zip");

/**
 * Confine every rule to the plugin's container (.tt-root) so the app never restyles the
 * theme, and turn rem into px because some themes change the root font size.
 */
function scopeCss(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf("{", i);
    if (open < 0) break;
    const head = src.slice(i, open).trim();
    const close = matchBrace(src, open);
    const body = src.slice(open + 1, close);
    if (head.startsWith("@media") || head.startsWith("@supports") || head.startsWith("@container")) {
      out += `${head}{${scopeCss(body)}}`;
    } else if (head.startsWith("@")) {
      out += `${head}{${body}}`; // @keyframes, @font-face: keep as they are
    } else {
      out += `${splitSelectors(head).map(scopeSelector).join(",")}{${remToPx(body)}}`;
    }
    i = close + 1;
  }
  return out;
}

function matchBrace(s, open) {
  let depth = 0;
  for (let j = open; j < s.length; j++) {
    if (s[j] === "{") depth++;
    else if (s[j] === "}" && --depth === 0) return j;
  }
  throw new Error("unbalanced CSS");
}

function splitSelectors(sel) {
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const ch of sel) {
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

function scopeSelector(sel) {
  const m = sel.match(/^(html|body|:root)(?=$|[\s.:[>#])/);
  if (m) return ".tt-root" + sel.slice(m[0].length);
  return `.tt-root ${sel}`;
}

function remToPx(decls) {
  return decls.replace(/(-?\d*\.?\d+)rem\b/g, (_, n) => `${+(parseFloat(n) * 16).toFixed(3)}px`);
}

