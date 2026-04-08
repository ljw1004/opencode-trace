/**
 * Rendering library for codex-trace logs.
 *
 * A codex-trace log is a sequence of jsonl lines in an unterminated `<!` + `--` comment at the end of an HTML document.
 * This module extracts that log and renders each line as a collapsible tree-structure.
 *
 * There's a little bit of cleverness. This module uses a `render()` function to determine how nodes in the tree
 * should be rendered. Normally they're rendered in the normal way (primitives as leaf nodes, objects and arrays as
 * collapsible nodes whose children are recursively rendered). But if the `render()` function at any level returns
 * an object with special properties `{Symbol('TITLE'): ..., Symbol('INLINE'): ..., body: ..., open: ...}`
 * then that object decides how it should be rendered in the tree. Within an object/array, it will be rendered
 * as "▷ TITLE: INLINE" when collapsed, or "▽ TITLE" when expanded, with 'body' an object/array/primitive for
 * the contents of that expanded node. The `open` flag says whether it should be initially expanded.
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
    .replace(/\n/g, '<br/>')
    .replace(/\\n/g, '<br/>');
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
  return s.replace(/\n/g, ' ').slice(0, 80);
}

/**
 * Interprets the content array of from an OpenAI payload into a string for display.
 * If we're given undefined, returns an empty string.
 */
function content(contents) {
  if (typeof contents === 'string') return contents;
  let r = [];
  for (const c of contents ?? []) {
    if (c.type === 'input_text') r.push(c.text);
    else if (c.type === 'output_text') r.push(c.text);
    else r.push(`[${c.type}]`);
  }
  return r.join('\n');
}

/**
 * Renders a sequence of elements from an OpenAI payload: messages, function_calls, function_call_outputs.
 */
function renderPayload(elements) {
  const payload = [];
  for (const e of elements) {
    if (e === '...') {
      payload.push({[TITLE]: 'Added...'});
    } else if (e === '---') {
      payload.push({[TITLE]: 'Removed...'});
    } else if (e.type === 'message') {
      payload.push({
        [TITLE]: `${payload.length}: message(${esc(e.role)}): `,
        [INLINE]: esc(short(content(e.content))),
        body: content(e.content),
      });
    } else if (e.type === 'input_text' || e.type === 'output_text') {
      payload.push({
        [TITLE]: `${payload.length}: ${e.type}: `,
        [INLINE]: esc(short(e.text)),
        body: e.text,
      });

    } else if (e.type === 'function_call_output') {
      payload.push({
        [TITLE]: `${payload.length}: `,
        [INLINE]: `function_call_output: ${esc(short(e.output))}`,
        body: e,
      });
    } else if (e.type === 'function_call') {
      let arg;
      try {
        const j = JSON.parse(e.arguments);
        arg = j.cmd ?? j.pattern;
        arg = `"${esc(short(arg))}"`;
      } catch (e) {
        arg = '...';
      }
      payload.push({
        [TITLE]: `${payload.length}: `,
        [INLINE]: `function_call: ${esc(e.name)}(${esc(short(arg))})`,
        body: e,
      });
    } else {
      payload.push({
        [TITLE]: `${payload.length}: `,
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
  const id = data?._id !== undefined ? ` #${data._id}` : '';
  const purpose = data?._purpose ? ` ${data._purpose}` : '';
  if (data?.[TITLE] !== undefined) {
    return data;
  } else if (data?._kind === 'request') {
    const input = data['input'] ?? data['input+'] ?? data['input-'] ?? data['*input'] ?? [];
    // OpenCode request bodies can mix message wrappers like
    // `{role:'user', content:[{type:'input_text', text:'...'}]}` with already-typed items like
    // `{type:'function_call', ...}`. Flatten wrapper objects to their `content` items so `payload`
    // is always a list of typed entries like `{type:'input_text', ...}` or `{type:'function_call', ...}`.
    const payload = input.flatMap(e =>
      e && typeof e === 'object' && !Array.isArray(e) && e.type === undefined && Array.isArray(e.content)
        ? e.content
        : e && typeof e === 'object' && !Array.isArray(e) && e.type === undefined && typeof e.content === 'string'
          ? [{type: 'input_text', text: e.content}]
        : [e],
    );
    const rendered = renderPayload(payload);
    const raw = {...data};
    delete raw._kind;
    return {
      [TITLE]: `[${esc(ts(data))}] <b>REQUEST${id}${purpose}</b> `,
      body: [...rendered, {[TITLE]: 'raw', body: raw}],
      open: true,
    };
  } else if (data?._kind === 'response') {
    const payload = renderPayload(
      data['output'] ?? data['output+'] ?? data['output-'] ?? data['*output'] ?? [],
    );
    const raw = {...data};
    delete raw._kind;
    return {
      [TITLE]: `[${esc(ts(data))}] <b>RESPONSE${id}${purpose}</b> `,
      body: [...payload, {[TITLE]: 'raw', body: raw}],
      open: true,
    };
  } else if (data?._kind === 'error') {
    const raw = {...data};
    return {
      [TITLE]: `[${esc(ts(data))}] <b>ERROR${id}${purpose}</b> `,
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
      [TITLE]: `[${esc(ts(data))}] <b>${esc(data._kind)}</b> `,
      body: raw,
      open: true,
    };
  } else {
    return {
      [TITLE]: esc(label),
      [INLINE]: esc(
        Array.isArray(data)
          ? `[...${data.length} items]`
          : '{' +
              Object.keys(data)
                .map(k => `${JSON.stringify(k)}:`)
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
      `<details><summary>${r[TITLE]}<output>${r[INLINE] ?? ''}</output></summary></details>`,
    );
    d.addEventListener(
      'toggle',
      () => {
        if (r.body === undefined) {
          // skip
        } else if (Array.isArray(r.body)) {
          r.body.forEach((item, i) =>
            d.appendChild(buildNode(item, r?.numbered ? `${i + 1}: ` : '')),
          );
        } else if (r.body && typeof r.body === 'object') {
          Object.keys(r.body).forEach(k =>
            d.appendChild(buildNode(r.body[k], `${JSON.stringify(k)}: `)),
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
    return fromHTML(`<div>${esc(label)}${esc(JSON.stringify(data))}</div>`);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  if (
    document.lastChild &&
    document.lastChild.nodeType === Node.COMMENT_NODE &&
    document.lastChild.data.trim()
  ) {
    for (const line of document.lastChild.data.split(/\r?\n/).filter(Boolean)) {
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
