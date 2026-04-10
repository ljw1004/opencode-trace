/**
 * OpenCode server plugin which captures raw LLM HTTP payloads to `~/opencode-trace`.
 *
 * Each trace is an interactive html file whose trailing unterminated html-comment contains
 * one json object per line. To read the logs programmatically, strip everything up to that
 * final comment. To browse them interactively, open the html file directly in a browser.
 *
 * For development this source file reads `./opencode-trace.js` and inlines it into each html
 * logfile at write time. `npm run build` produces `dist/opencode-trace.ts`, where the same
 * viewer source has already been inserted into the placeholder in `PREAMBLE`.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import os from "node:os"
import path from "node:path"

const root = path.join(os.homedir(), "opencode-trace")
const PREAMBLE = `<!DOCTYPE html>
<html>
<head>
    <style>
        body {font-family: system-ui, -apple-system, sans-serif; margin: 0;}
        body>details {margin-top: 1ex; padding-top: 1ex; border-top: 1px solid lightgray;}
        details {position: relative; padding-left: 1.25em;}
        summary {list-style: none; cursor: pointer;}
        summary::-webkit-details-marker {display: none;}
        summary::before {content: '▷';position: absolute;left: 0;color: #666;}
        details[open]>summary::before {content: '▽';}
        details>div {margin-left: 1.25em;}
        details[open]>summary output {display: none;}
    </style>
    <script src="opencode-trace.js"></script>
    <script>
        if (window.buildNode === undefined) {
          /**
 * Rendering library for codex-trace logs.
 *
 * A codex-trace log is a sequence of jsonl lines in an unterminated \`<!\` + \`--\` comment at the end of an HTML document.
 * This module extracts that log and renders each line as a collapsible tree-structure.
 *
 * There's a little bit of cleverness. This module uses a \`render()\` function to determine how nodes in the tree
 * should be rendered. Normally they're rendered in the normal way (primitives as leaf nodes, objects and arrays as
 * collapsible nodes whose children are recursively rendered). But if the \`render()\` function at any level returns
 * an object with special properties \`{Symbol('TITLE'): ..., Symbol('INLINE'): ..., body: ..., open: ...}\`
 * then that object decides how it should be rendered in the tree. Within an object/array, it will be rendered
 * as "▷ TITLE: INLINE" when collapsed, or "▽ TITLE" when expanded, with 'body' an object/array/primitive for
 * the contents of that expanded node. The \`open\` flag says whether it should be initially expanded.
 *
 * This module has special handling for REQUEST and RESPONSE json payloads for Codex's communication with an LLM.
 */

const TITLE = Symbol('TITLE');
const INLINE = Symbol('INLINE');
// Invariant: the contents of [TITLE] and [INLINE] have both been escaped

/**
 * Turns an html string into a DOM node
 */
function fromHTML(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

/**
 * Escapes string for safe insertion into HTML
 */
function esc(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\\n/g, '<br/>')
    .replace(/\\\\n/g, '<br/>');
}

/**
 * Given a datstring in ISO format, returns HH:MM:SS
 */
function ts(data) {
  return data?._ts?.slice(11, 19) ?? '?';
}

/**
 * Puts a string onto a single line and truncates to 80 chars, for display in INLINE part of a node
 */
function short(s) {
  return s.replace(/\\n/g, ' ').slice(0, 80);
}

/**
 * Interprets a message-content array into text for display.
 * If we're given undefined, returns an empty string.
 */
function contentText(contents) {
  if (typeof contents === 'string') return contents;
  if (!Array.isArray(contents)) return JSON.stringify(contents ?? '');
  let r = [];
  for (const c of contents ?? []) {
    if (c.type === 'input_text') r.push(c.text);
    else if (c.type === 'output_text') r.push(c.text);
    else if (c.type === 'text') r.push(c.text);
    else r.push(\`[\${c.type}]\`);
  }
  return r.join('\\n');
}

/**
 * Renders a sequence of payload elements from either OpenAI or Anthropic payloads.
 */
function renderPayload(elements) {
  if (!Array.isArray(elements)) return [];
  const payload = [];
  for (const e of elements) {
    if (e === '...') {
      payload.push({[TITLE]: 'Added...'});
    } else if (e === '---') {
      payload.push({[TITLE]: 'Removed...'});
    } else if (e.type === 'message' || (e.type === undefined && e.role !== undefined && e.content !== undefined)) {
      payload.push({
        [TITLE]: \`\${payload.length}: message(\${esc(e.role)}): \`,
        [INLINE]: esc(short(contentText(e.content))),
        body: contentText(e.content),
      });
    } else if (e.type === 'input_text' || e.type === 'output_text' || e.type === 'text') {
      payload.push({
        [TITLE]: \`\${payload.length}: \${e.type}: \`,
        [INLINE]: esc(short(e.text)),
        body: e.text,
      });

    } else if (e.type === 'function_call_output' || e.type === 'tool_result') {
      const result = (e.type === 'function_call_output') ? 
      (typeof e.output === 'string' ? e.output : JSON.stringify(e.output ?? ''))
      : typeof e.content === 'string' ? e.content : contentText(e.content);
      payload.push({
        [TITLE]: \`\${payload.length}: \`,
        [INLINE]: \`\${esc(e.type)}: \${esc(short(result))}\`,
        body: e,
      });
    } else if (e.type === 'function_call' || e.type === 'tool_use') {
      let arg = "";
      try {
        const raw = e.type === 'function_call' ? JSON.parse(e.arguments) : e.input;
        const rawArg = raw?.cmd ?? raw?.pattern ?? raw;
        arg = typeof rawArg === 'string' ? rawArg : JSON.stringify(rawArg ?? '');
      } catch (e) {
        arg = '...';
      }
      payload.push({
        [TITLE]: \`\${payload.length}: \`,
        [INLINE]: \`\${esc(e.type)}: \${esc(e.name ?? '???')}(\${esc(short(arg))})\`,
        body: e,
      });
    } else {
      payload.push({
        [TITLE]: \`\${payload.length}: \`,
        [INLINE]: esc(e.type ?? '???'),
        body: e,
      });
    }
  }
  return payload;
}

/**
 * Renders a node in the tree.
 * If it looks like a REQUEST or RESPONSE payload (has ._kind property) then renders it conveniently.
 * Otherwise, renders primtives, objects, arrays in the obvious way.
 */
function render(data, label) {
  const deltaField = (key) => data[key] ?? data[\`\${key}+\`] ?? data[\`\${key}-\`] ?? data[\`*\${key}\`];
  const id = data?._id !== undefined ? \` #\${data._id}\` : '';
  const purpose = data?._purpose ? \` \${data._purpose}\` : '';
  if (data?.[TITLE] !== undefined) {
    return data;
  } else if (data?._kind === 'request') {
    const rendered = renderPayload(deltaField('input') ?? deltaField('messages'));
    const raw = {...data};
    delete raw._kind;
    return {
      [TITLE]: \`[\${esc(ts(data))}] <b>REQUEST\${id}\${purpose}</b> \`,
      body: [...rendered, {[TITLE]: 'raw', body: raw}],
      open: true,
    };
  } else if (data?._kind === 'response') {
    const payload = renderPayload(deltaField('output') ?? deltaField('content'));
    const raw = {...data};
    delete raw._kind;
    return {
      [TITLE]: \`[\${esc(ts(data))}] <b>RESPONSE\${id}\${purpose}</b> \`,
      body: [...payload, {[TITLE]: 'raw', body: raw}],
      open: true,
    };
  } else if (data?._kind === 'error') {
    const raw = {...data};
    return {
      [TITLE]: \`[\${esc(ts(data))}] <b>ERROR\${id}\${purpose}</b> \`,
      [INLINE]: esc(short(data._error ?? '')),
      body: [
        data._error ?? '???',
        ...(data._stack ? [{[TITLE]: 'stack', body: data._stack}] : []),
        {[TITLE]: 'raw', body: raw},
      ],
      open: true,
    };
  } else if (data?._kind !== undefined && data?._ts !== undefined) {
    const raw = {...data};
    return {
      [TITLE]: \`[\${esc(ts(data))}] <b>\${esc(data._kind)}</b> \`,
      body: raw,
      open: true,
    };
  } else {
    return {
      [TITLE]: esc(label),
      [INLINE]: esc(
        Array.isArray(data)
          ? \`[...\${data.length} items]\`
          : '{' +
              Object.keys(data)
                .map(k => \`\${JSON.stringify(k)}:\`)
                .join(',') +
              '}',
      ),
      body: data,
      numbered: true,
    };
  }
}

function buildNode(data, label) {
  if (data && typeof data === 'object') {
    const r = render(data, label);
    const d = fromHTML(
      \`<details><summary>\${r[TITLE]}<output>\${r[INLINE] ?? ''}</output></summary></details>\`,
    );
    d.addEventListener(
      'toggle',
      () => {
        if (r.body === undefined) {
          // skip
        } else if (Array.isArray(r.body)) {
          r.body.forEach((item, i) =>
            d.appendChild(buildNode(item, r?.numbered ? \`\${i + 1}: \` : '')),
          );
        } else if (r.body && typeof r.body === 'object') {
          Object.keys(r.body).forEach(k =>
            d.appendChild(buildNode(r.body[k], \`\${JSON.stringify(k)}: \`)),
          );
        } else {
          d.appendChild(buildNode(r.body, ''));
        }
      },
      {once: true},
    );
    d.open = r.open;
    return d;
  } else {
    return fromHTML(\`<div>\${esc(label)}\${esc(JSON.stringify(data))}</div>\`);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  if (
    document.lastChild &&
    document.lastChild.nodeType === Node.COMMENT_NODE &&
    document.lastChild.data.trim()
  ) {
    for (const line of document.lastChild.data.split(/\\r?\\n/).filter(Boolean)) {
      let data = '';
      try {
        data = JSON.parse(line);
      } catch (e) {
        data = {error: String(e), raw: line};
      }
      const node = buildNode(data, 'json:');
      node.classList.add('log-entry');
      document.body.appendChild(node);
    }
  }
});

        }
    </script>
</head>
<body>
</body>
</html>
${"<!" + "--"}
`

/** Mutable global state: maps OpenCode session ids to the html logfile path for that session. */
const files = new Map<string, string>()

/** Mutable global state: maps `session\nmethod\nurl\n_kind\nmeta|real` to the previous raw body used as the delta base. */
const prevs = new Map<string, object>()

/** Mutable global state: maps OpenCode session ids to the next per-session fetch sequence number. */
const ids = new Map<string, number>()

/** Mutable module state: the unpatched global fetch for this module instance, assigned inside `server()`. */
let orig: typeof globalThis.fetch | undefined

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v)
}

/**
 * Given a parsed LLM request body, returns the first user prompt text if one is present, e.g.
 * {input:[{role:"user",content:[{type:"input_text",text:"why is the sky blue?"}]}]}
 * ==> "why is the sky blue?"
 */
function extractPromptFromRequestBody(v: Record<string, unknown>): string | undefined {
  const usable = (text: string | undefined): string | undefined => {
    const trimmed = text?.trim()
    return trimmed && trimmed !== "Generate a title for this conversation:" ? trimmed : undefined
  }
  const text = (part: unknown): string | undefined => {
    if (typeof part === "string") return usable(part)
    if (!isRecord(part)) return
    if (typeof part.text === "string") return usable(part.text)
    if (typeof part.input_text === "string") return usable(part.input_text)
    return undefined
  }
  const content = (v: unknown): string | undefined => {
    if (typeof v === "string") return v
    if (!Array.isArray(v)) return undefined
    for (const part of v) {
      const found = text(part)
      if (found) return found
    }
    return undefined
  }
  const first = (list: unknown, key: "input" | "messages"): string | undefined => {
    if (!Array.isArray(list)) return undefined
    for (const item of list) {
      if (!isRecord(item)) continue
      if (item.role !== "user") continue
      const found = content(item.content) ?? (key === "input" ? text(item) : undefined)
      if (found) return found
    }
    return undefined
  }
  return first(v.input, "input") ?? first(v.messages, "messages") ?? (typeof v.prompt === "string" ? v.prompt : undefined)
}

/**
 * Appends one row to the session logfile.
 * If this is the first row for the session, also chooses the filename and writes the html preamble.
 * Side effects: may create directories, create a logfile, mutate `files`, and append to disk.
 */
function write(id: string, name: string, row: Record<string, unknown>): void {
  const prev = files.get(id)
  const d = new Date()
  const file = prev ?? path.join(
    root,
    `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()} ${d.getHours()}.${d.getMinutes()}.${d.getSeconds()} ${name}.html`,
  )
  mkdirSync(root, { recursive: true })
  if (!existsSync(file)) {
    const html = PREAMBLE.includes("// {opencode-trace.js}")
      ? PREAMBLE.replace(
          "// {opencode-trace.js}",
          readFileSync(new URL("./opencode-trace.js", import.meta.url), "utf8"),
        )
      : PREAMBLE
    appendFileSync(
      file,
      html,
    )
  }
  files.set(id, file)
  appendFileSync(file, `${JSON.stringify(row).replace(/-->/g, "--\\u003e")}\n`)
}

/**
 * Given two json values, returns a bool for whether they are identical, plus a representation
 * of the difference intended for humans to read.
 *
 * The representation always has the same type as `next`.
 *
 * For changed lists, the representation is either the full new list, or, when shorter,
 * `['...', additions, '---', removals]`.
 *
 * For dicts, removed keys appear as `-k: null`, added keys as `+k: v`, and changed keys as
 * `*k: v`. If a changed dict field is itself a compact list diff, that is rendered as
 * `k+: [...]` and `k-: [...]` for readability.
 */
function delta(prev: unknown, next: unknown): [unknown, boolean] {
  const hash = (v: unknown): string => {
    const sort = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(sort)
      if (!v || typeof v !== "object") return v
      return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort((v as Record<string, unknown>)[k])]))
    }
    return createHash("blake2b512").update(JSON.stringify(sort(v))).digest("hex")
  }
  if (isRecord(prev) && isRecord(next)) {
    const out: Record<string, unknown> = {}
    const pk = new Set(Object.keys(prev))
    const nk = new Set(Object.keys(next))
    for (const k of [...pk].filter((k) => !nk.has(k)).sort()) out[`-${k}`] = null
    for (const k of [...nk].filter((k) => !pk.has(k)).sort()) out[`+${k}`] = next[k]
    for (const k of [...pk].filter((k) => nk.has(k)).sort()) {
      const [sub, same] = delta(prev[k], next[k])
      if (same) {
        const raw = JSON.stringify(next[k]) ?? ""
        out[k] =
          raw.length < 128
            ? next[k]
            : Array.isArray(next[k])
              ? ["..."]
              : isRecord(next[k])
                ? { "[unchanged]": "[unchanged]" }
                : typeof next[k] === "string"
                  ? "[unchanged]"
                  : next[k]
        continue
      }
      if (!Array.isArray(sub) || (sub[0] !== "..." && sub[0] !== "---")) {
        out[`*${k}`] = sub
        continue
      }
      const cut = sub.findIndex((item) => item === "---")
      const cut2 = cut === -1 ? undefined : cut
      const add = cut2 === 0 ? [] : cut2 == null ? sub.slice(1) : sub.slice(1, cut2)
      const del = cut2 == null ? [] : sub.slice(cut2 + 1)
      if (del.length > 0) out[`${k}-`] = del
      if (add.length > 0) out[`${k}+`] = add
    }
    return Object.keys(out).length === 0 ? [{ "[repeat]": "[repeat]" }, true] : [out, false]
  }
  if (Array.isArray(prev) && Array.isArray(next)) {
    const left: Array<readonly [unknown, string]> = prev.map((v) => [v, hash(v)] as const)
    let right: Array<readonly [unknown, string]> = next.map((v) => [v, hash(v)] as const)
    const add: unknown[] = []
    const del: unknown[] = []
    for (const [value, sig] of left) {
      const ix = right.findIndex((item) => item[1] === sig)
      if (ix === -1) {
        del.push(value)
        continue
      }
      add.push(...right.slice(0, ix).map((item) => item[0]))
      right = right.slice(ix + 1)
    }
    add.push(...right.map((item) => item[0]))
    if (add.length === 0 && del.length === 0) return [next, true]
    if (add.length + del.length < next.length) {
      return del.length === 0
        ? [["...", ...add], false]
        : add.length === 0
          ? [["---", ...del], false]
          : [["...", ...add, "---", ...del], false]
    }
    return [next, false]
  }
  return [next, prev === next]
}

/** Given two objects, returns their shallow merge, else just returns the right-hand side. */
function merge(a: unknown, b: unknown): unknown {
  if (!isRecord(a) || !isRecord(b)) return b
  return { ...a, ...b }
}

/**
 * Given an SSE response body, returns parsed `{event?, data}` blocks.
 * Returns undefined if the body is not parseable SSE json.
 */
function events(text: string): Array<{ event: string | undefined; data: unknown }> | undefined {
  const out: Array<{ event: string | undefined; data: unknown }> = []
  for (const block of text.split(/\r?\n\r?\n/)) {
    if (!block.trim()) continue
    let name: string | undefined
    const data = block
      .split(/\r?\n/)
      .flatMap((line) => {
        if (line.startsWith("event:")) {
          name = line.slice(6).trim()
          return []
        }
        if (line.startsWith("data:")) return [line.slice(5).trimStart()]
        return []
      })
      .join("\n")
    if (!data || data === "[DONE]") continue
    try {
      out.push({ event: name, data: JSON.parse(data) as unknown })
    } catch {
      return
    }
  }
  return out.length > 0 ? out : undefined
}

/** Given parsed OpenAI `/responses` SSE blocks, reconstructs the final response object. */
function openaiResponses(list: Array<{ data: unknown }>): Record<string, unknown> {
  let base: Record<string, unknown> = { object: "response" }
  const ids: string[] = []
  const items = new Map<string, Record<string, unknown>>()
  const sums = new Map<string, string>()
  for (const row of list) {
    if (!isRecord(row.data) || typeof row.data.type !== "string") continue
    if (isRecord(row.data.response)) base = merge(base, row.data.response) as Record<string, unknown>
    if (row.data.type === "response.output_item.added" && isRecord(row.data.item) && typeof row.data.item.id === "string") {
      const id = row.data.item.id
      const item = { ...row.data.item }
      if (item.type === "message") item.content = (items.get(id)?.content as unknown[]) ?? []
      if (!ids.includes(id)) ids.push(id)
      items.set(id, item)
      continue
    }
    if (row.data.type === "response.output_text.delta" && typeof row.data.item_id === "string") {
      const prev = items.get(row.data.item_id) ?? { id: row.data.item_id, type: "message", role: "assistant", content: [] }
      const content: unknown[] = Array.isArray(prev.content) ? [...(prev.content as unknown[])] : []
      const last = content[content.length - 1]
      if (isRecord(last) && last.type === "output_text" && typeof last.text === "string") {
        last.text += typeof row.data.delta === "string" ? row.data.delta : ""
      } else {
        content.push({ type: "output_text", text: typeof row.data.delta === "string" ? row.data.delta : "" })
      }
      items.set(row.data.item_id, { ...prev, content })
      if (!ids.includes(row.data.item_id)) ids.push(row.data.item_id)
      continue
    }
    if (row.data.type === "response.function_call_arguments.delta" && typeof row.data.item_id === "string") {
      const prev = items.get(row.data.item_id) ?? { id: row.data.item_id, type: "function_call", arguments: "" }
      items.set(row.data.item_id, {
        ...prev,
        arguments: `${typeof prev.arguments === "string" ? prev.arguments : ""}${typeof row.data.delta === "string" ? row.data.delta : ""}`,
      })
      if (!ids.includes(row.data.item_id)) ids.push(row.data.item_id)
      continue
    }
    if (row.data.type === "response.function_call_arguments.done" && typeof row.data.item_id === "string") {
      const prev = items.get(row.data.item_id) ?? { id: row.data.item_id, type: "function_call" }
      items.set(row.data.item_id, {
        ...prev,
        arguments: typeof row.data.arguments === "string" ? row.data.arguments : prev.arguments,
      })
      if (!ids.includes(row.data.item_id)) ids.push(row.data.item_id)
      continue
    }
    if (row.data.type === "response.reasoning_summary_text.delta" && typeof row.data.item_id === "string") {
      sums.set(row.data.item_id, `${sums.get(row.data.item_id) ?? ""}${typeof row.data.delta === "string" ? row.data.delta : ""}`)
      continue
    }
    if (row.data.type === "response.output_item.done" && isRecord(row.data.item) && typeof row.data.item.id === "string") {
      const prev = items.get(row.data.item.id) ?? {}
      const next = { ...prev, ...row.data.item }
      if (Array.isArray(prev.content) && !Array.isArray(next.content)) next.content = prev.content
      if (typeof prev.arguments === "string" && typeof next.arguments !== "string") next.arguments = prev.arguments
      items.set(row.data.item.id, next)
      if (!ids.includes(row.data.item.id)) ids.push(row.data.item.id)
    }
  }
  const output = ids.map((id) => {
    const item = { ...(items.get(id) ?? { id }) }
    if (item.type === "reasoning" && sums.has(id)) item.summary = [{ type: "summary_text", text: sums.get(id) }]
    return item
  })
  return { ...base, output }
}

/** Given parsed OpenAI chat-completions SSE blocks, reconstructs the final completion json. */
function openaiChat(list: Array<{ data: unknown }>): Record<string, unknown> {
  const choices = new Map<number, Record<string, unknown>>()
  let id = ""
  let model = ""
  let created = 0
  let usage: unknown
  for (const row of list) {
    if (!isRecord(row.data)) continue
    if (typeof row.data.id === "string") id = row.data.id
    if (typeof row.data.model === "string") model = row.data.model
    if (typeof row.data.created === "number") created = row.data.created
    if (isRecord(row.data.usage)) usage = row.data.usage
    if (!Array.isArray(row.data.choices)) continue
    for (const part of row.data.choices) {
      if (!isRecord(part)) continue
      const ix = typeof part.index === "number" ? part.index : 0
      const prev = choices.get(ix) ?? { index: ix, message: { role: "assistant" }, finish_reason: null }
      const msg: Record<string, unknown> = isRecord(prev.message) ? { ...prev.message } : { role: "assistant" }
      if (isRecord(part.delta)) {
        if (typeof part.delta.role === "string") msg.role = part.delta.role
        if (typeof part.delta.content === "string") msg.content = `${typeof msg.content === "string" ? msg.content : ""}${part.delta.content}`
        if (typeof part.delta.reasoning_content === "string") {
          msg.reasoning_content = `${typeof msg.reasoning_content === "string" ? msg.reasoning_content : ""}${part.delta.reasoning_content}`
        }
        if (Array.isArray(part.delta.tool_calls)) {
          const calls: unknown[] = Array.isArray(msg.tool_calls) ? [...(msg.tool_calls as unknown[])] : []
          for (const call of part.delta.tool_calls) {
            if (!isRecord(call)) continue
            const jx = typeof call.index === "number" ? call.index : calls.length
            const prevCall = isRecord(calls[jx])
              ? { ...calls[jx] }
              : { index: jx, id: call.id, type: call.type ?? "function", function: { name: "", arguments: "" } }
            const fn = isRecord(prevCall.function) ? { ...prevCall.function } : { name: "", arguments: "" }
            if (isRecord(call.function) && typeof call.function.name === "string") fn.name = call.function.name
            if (isRecord(call.function) && typeof call.function.arguments === "string") {
              fn.arguments = `${typeof fn.arguments === "string" ? fn.arguments : ""}${call.function.arguments}`
            }
            calls[jx] = { ...prevCall, ...call, function: fn }
          }
          msg.tool_calls = calls
        }
      }
      choices.set(ix, {
        ...prev,
        message: msg,
        finish_reason: part.finish_reason ?? prev.finish_reason ?? null,
      })
    }
  }
  return {
    id,
    object: "chat.completion",
    created,
    model,
    choices: [...choices.values()].sort((a, b) => Number(a.index) - Number(b.index)),
    ...(usage ? { usage } : {}),
  }
}

/** Given parsed Anthropic SSE blocks, reconstructs the final message json. */
function anthropic(list: Array<{ data: unknown }>): Record<string, unknown> {
  let base: Record<string, unknown> = { type: "message", role: "assistant" }
  const blocks = new Map<number, Record<string, unknown>>()
  const json = new Map<number, string>()
  for (const row of list) {
    if (!isRecord(row.data) || typeof row.data.type !== "string") continue
    if (row.data.type === "message_start" && isRecord(row.data.message)) {
      base = { ...base, ...row.data.message }
      continue
    }
    if (row.data.type === "content_block_start" && typeof row.data.index === "number" && isRecord(row.data.content_block)) {
      blocks.set(row.data.index, { ...row.data.content_block })
      continue
    }
    if (row.data.type === "content_block_delta" && typeof row.data.index === "number" && isRecord(row.data.delta)) {
      const prev = blocks.get(row.data.index) ?? { type: "text", text: "" }
      if (row.data.delta.type === "text_delta") blocks.set(row.data.index, { ...prev, text: `${typeof prev.text === "string" ? prev.text : ""}${typeof row.data.delta.text === "string" ? row.data.delta.text : ""}` })
      if (row.data.delta.type === "input_json_delta") json.set(row.data.index, `${json.get(row.data.index) ?? ""}${typeof row.data.delta.partial_json === "string" ? row.data.delta.partial_json : ""}`)
      continue
    }
    if (row.data.type === "message_delta") {
      if (isRecord(row.data.delta)) base = { ...base, ...row.data.delta }
      if (isRecord(row.data.usage)) base.usage = merge(base.usage, row.data.usage)
      continue
    }
    if (isRecord(row.data.usage)) base.usage = merge(base.usage, row.data.usage)
  }
  const content = [...blocks.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ix, block]) => {
      if (block.type !== "tool_use" || !json.has(ix)) return block
      const raw = json.get(ix) ?? ""
      try {
        return { ...block, input: JSON.parse(raw) as unknown }
      } catch {
        return { ...block, input: raw }
      }
    })
  return { ...base, content }
}

/**
 * Given a raw response body and url, returns the final json to log.
 * Plain json is returned directly; known SSE formats are consolidated; failures become `{_body}`.
 */
function responseAsJson(text: string, url: string): Record<string, unknown> {
  try {
    const body = JSON.parse(text) as unknown
    return isRecord(body) ? body : { _body: text }
  } catch {
    const list = events(text)
    if (!list) return { _body: text }
    const path = ((): string => {
      try {
        return new URL(url).pathname
      } catch {
        return url
      }
    })()
    const first = list[0]?.data
    if (path.endsWith("/responses") || (isRecord(first) && typeof first.type === "string" && first.type.startsWith("response."))) {
      return openaiResponses(list)
    }
    if (path.endsWith("/chat/completions") || (isRecord(first) && first.object === "chat.completion.chunk")) {
      return openaiChat(list)
    }
    if (path.endsWith("/messages") || (isRecord(first) && typeof first.type === "string" && (first.type === "message_start" || first.type === "content_block_start"))) {
      return anthropic(list)
    }
    return { _body: text }
  }
}

/**
 * Intercepts matching OpenCode LLM fetches and logs request/response rows.
 * Side effects: mutates `prevs`, mutates `ids`, and writes logs to disk.
 */
async function tracedFetch(
  input: Parameters<typeof globalThis.fetch>[0],
  init?: Parameters<typeof globalThis.fetch>[1],
): Promise<Response> {
  const now = (): string => new Date().toISOString()
  const error = (err: unknown) => err instanceof Error ? { _error: err.message, _stack: err.stack } : { _error: String(err) }

  const req = new Request(input, init)
  const session = req.headers.get("x-opencode-session") ?? req.headers.get("x-session-affinity") ?? req.headers.get("session_id") ?? undefined;
  if (session === undefined) return orig!(input,init);

  const text = await req.clone().text().catch(() => "")
  const raw = ((): Record<string, unknown> => {
    try {
      const body = JSON.parse(text) as unknown
      return isRecord(body) ? body : { _body: text }
    } catch {
      return { _body: text }
    }
  })()
  const title = isRecord(raw) && typeof raw._body !== "string" ? extractPromptFromRequestBody(raw) : undefined
  const purpose = isRecord(raw) && Array.isArray(raw.tools) && raw.tools.length > 0 ? '' : '[meta]';
  const seq = (ids.get(session) ?? 0) + 1
  ids.set(session, seq)
  const common = { _id: seq, _purpose: purpose, _url: req.url }
  const name = (title ?? session ?? '')
    .replace(/[^A-Za-z0-9 _-]+/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 10)
    .join(" ")
    .slice(0, 50)
    .trim() || "session";
  const requestKey = `${session}\n${req.method}\n${req.url}\nrequest\n${purpose}`
  const requestNext = raw as object
  const [requestRow] = delta(prevs.get(requestKey), requestNext)
  prevs.set(requestKey, requestNext)
  write(session, name, {
    ...(requestRow as Record<string, unknown>),
    ...common,
    _kind: "request",
    _ts: now(),
  })

  const res = await orig!(req).catch((err) => {
    write(session, name, {
      ...common,
      _kind: "error",
      _ts: now(),
      ...error(err),
    })
    throw err
  });
  // We'll register background processing of the response, once it comes. But return 'res' immediately.
  void res
    .clone()
    .text()
    .then((body) => {
      const json = responseAsJson(body, req.url)
      const detail = isRecord(json) && isRecord(json.error) && typeof json.error.message === "string"
        ? json.error.message
        : isRecord(json) && typeof json.error === "string"
          ? json.error
          : `${res.status} ${res.statusText}`
      const responseNext = (!res.ok
        ? { ...json, _status: res.status, _status_text: res.statusText, _error: detail }
        : json) as object
      const responseKey = `${session}\n${req.method}\n${req.url}\nresponse\n${purpose}`
      const [responseRow] = delta(prevs.get(responseKey), responseNext)
      prevs.set(responseKey, responseNext)
      write(session, name, {
        ...(responseRow as Record<string, unknown>),
        ...common,
        _kind: "response",
        _ts: now(),
      })
    })
    .catch((err) => {
      write(session, name, {
        ...common,
        _kind: "error",
        _ts: now(),
        ...error(err),
      })
    })
  return res
}

export default {
  id: "ljw.opencode-trace",
  async server(): Promise<object> {
    // OpenCode loads this module with dynamic import() when plugin state is initialized for
    // an instance/directory. In current OpenCode this module import is normally cached, so
    // top-level state like `orig`, `files`, and `prevs` survives repeated hook initialization.
    //
    // OpenCode then calls `server()` when it initializes this plugin's server hooks for that
    // instance. That can happen more than once per process across instance reload/dispose, so
    // the fetch patch must be guarded even though the module itself is usually only loaded once.
    if (!orig) {
      orig = globalThis.fetch.bind(globalThis)
      globalThis.fetch = tracedFetch
    }
    return {}
  },
}

// For opencode versions prior to 1.4, it doesn't get picked up automatically from the plugins
// directory so you have to add this to your ~/.config/opencode/opencode.json
//  "plugin": [
//    "file:///path/to/.config/opencode/plugins/opencode-trace.ts"
//  ]
//
// And it uses a different default export:
// export default async function opencodeTracePlugin() {
//   if (!orig) {
//     orig = globalThis.fetch.bind(globalThis);
//     globalThis.fetch = tracedFetch;
//   }
//   return {}
// }
