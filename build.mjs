import { mkdirSync, readFileSync, writeFileSync } from "node:fs"

// Builds dist/opencode-trace.ts by inserting ./opencode-trace.js into ./opencode-trace.ts
// in a format that (1) works, (2) is allowed as an opencode plugin
// Assumption: ./opencode-trace.{ts,js} doesn't include `<--` since bun/opencode rejects that.
// Assumption: ./opencode-trace.ts wants us to replace the first instance of `// {opencode-trace.js}`
// Assumption: that first occurrence is inside a template literal

let js = readFileSync(new URL("./opencode-trace.js", import.meta.url), "utf8");

js = js.replaceAll("\\", "\\\\"); // /\n/g => /\\n/g -- because our backslashes must be escaped
js = js.replaceAll("`", "\\`");   // x=`a` => x=\`a\` -- our backquotes must be escaped
js = js.replaceAll("${", "\\${"); // x=`${b}` => x=\`\${b}\`  -- our string interpolation must be escaped

const src = readFileSync(new URL("./opencode-trace.ts", import.meta.url), "utf8");
const marker = "// {opencode-trace.js}";
const i = src.indexOf(marker);
if (i === -1) throw new Error(`build marker not found: ${marker}`);
const dst = src.slice(0, i) + js + src.slice(i + marker.length);
mkdirSync(new URL("./dist", import.meta.url), { recursive: true })
writeFileSync(new URL("./dist/opencode-trace.ts", import.meta.url), dst)
