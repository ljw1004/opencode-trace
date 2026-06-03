/**
 * opencode-trace viewer
 *
 * Embedded into each trace .html file at trace-creation time. Renders the
 * trailing `<!---->` JSONL comment as either an Enhanced view (token stats,
 * conversation timeline, system-prompt splitter, tool calls, etc.) or the
 * Classic collapsible tree. The choice is remembered in localStorage.
 *
 * Backwards-compat: still defines window.buildNode (the legacy tree renderer)
 * so any older code paths keep working.
 */
(function () {
  "use strict";

  // ---------- Constants ----------
  const TITLE = Symbol("TITLE");
  const INLINE = Symbol("INLINE");
  const STORAGE_KEY = "opencode-trace-viewer-mode";
  const DEFAULT_MODE = "enhanced"; // "enhanced" | "classic"

  // ---------- CSS (injected so it works whether embedded inline or via <script src>) ----------
  const CSS = `
  html, body { margin: 0; min-height: 100vh; }
  .otv-root { color: #e6edf3; background: #0d1117; }
  .otv-root[data-theme="light"] { color: #1f2328; background: #f6f8fa; }
  .otv-root a { color: #58a6ff; }
  .otv-root[data-theme="light"] a { color: #0969da; }
  .otv-root { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; font-size: 13.5px; line-height: 1.55; }
  .otv-mono, .otv-root code, .otv-root pre { font-family: ui-monospace, "SF Mono", Menlo, Monaco, "Cascadia Mono", Consolas, monospace; }
  .otv-root pre { margin: 0; white-space: pre-wrap; word-break: break-word; }
  .otv-root button { font-family: inherit; cursor: pointer; }
  .otv-root hr { border: none; border-top: 1px solid #30363d; }
  .otv-root[data-theme="light"] hr { border-top-color: #d0d7de; }

  /* Top bar */
  .otv-topbar { display: flex; align-items: center; gap: 12px; padding: 10px 18px; background: #161b22; border-bottom: 1px solid #30363d; position: sticky; top: 0; z-index: 10; }
  .otv-root[data-theme="light"] .otv-topbar { background: #ffffff; border-bottom-color: #d0d7de; }
  .otv-topbar h1 { font-size: 14px; font-weight: 600; margin: 0; letter-spacing: 0.2px; display: flex; align-items: center; gap: 8px; }
  .otv-topbar .otv-logo { width: 22px; height: 22px; background: linear-gradient(135deg, #58a6ff, #a371f7); border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; color: #fff; font-size: 12px; font-weight: 700; }
  .otv-topbar .otv-spacer { flex: 1; }
  .otv-topbar .otv-meta { color: #8b949e; font-size: 12px; }
  .otv-root[data-theme="light"] .otv-topbar .otv-meta { color: #59636e; }
  .otv-btn { background: #1c232c; border: 1px solid #30363d; color: #e6edf3; padding: 5px 10px; border-radius: 5px; font-size: 12px; }
  .otv-root[data-theme="light"] .otv-btn { background: #f0f3f6; border-color: #d0d7de; color: #1f2328; }
  .otv-btn:hover { border-color: #58a6ff; }
  .otv-btn.active { background: rgba(88,166,255,0.15); border-color: #58a6ff; color: #58a6ff; }
  .otv-btn-group { display: inline-flex; border: 1px solid #30363d; border-radius: 5px; overflow: hidden; }
  .otv-root[data-theme="light"] .otv-btn-group { border-color: #d0d7de; }
  .otv-btn-group .otv-btn { border: none; border-right: 1px solid #30363d; border-radius: 0; }
  .otv-root[data-theme="light"] .otv-btn-group .otv-btn { border-right-color: #d0d7de; }
  .otv-btn-group .otv-btn:last-child { border-right: none; }
  .otv-btn-group .otv-btn.active { background: rgba(88,166,255,0.15); }

  /* Summary */
  .otv-summary { display: grid; grid-template-columns: 1fr auto; gap: 16px; align-items: center; padding: 16px 24px; background: #161b22; border-bottom: 1px solid #30363d; }
  .otv-root[data-theme="light"] .otv-summary { background: #ffffff; border-bottom-color: #d0d7de; }
  .otv-summary h2 { margin: 0 0 4px; font-size: 15px; font-weight: 600; }
  .otv-summary .otv-sub { color: #8b949e; font-size: 12px; }
  .otv-root[data-theme="light"] .otv-summary .otv-sub { color: #59636e; }
  .otv-stats { display: flex; gap: 8px; flex-wrap: wrap; }
  .otv-stat { background: #1c232c; border: 1px solid #30363d; padding: 6px 12px; border-radius: 5px; font-size: 12px; min-width: 84px; }
  .otv-root[data-theme="light"] .otv-stat { background: #f0f3f6; border-color: #d0d7de; }
  .otv-stat .otv-label { color: #6e7681; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.4px; }
  .otv-root[data-theme="light"] .otv-stat .otv-label { color: #818b98; }
  .otv-stat .otv-value { font-weight: 600; font-size: 14px; margin-top: 2px; }
  .otv-stat.otv-in .otv-value { color: #58a6ff; }
  .otv-stat.otv-out .otv-value { color: #7ee787; }
  .otv-stat.otv-cache .otv-value { color: #d2a8ff; }
  .otv-stat.otv-tools .otv-value { color: #ffa657; }
  .otv-stat.otv-err .otv-value { color: #ff7b72; }

  /* Tabs */
  .otv-tabs { display: flex; background: #161b22; border-bottom: 1px solid #30363d; padding: 0 16px; gap: 2px; }
  .otv-root[data-theme="light"] .otv-tabs { background: #ffffff; border-bottom-color: #d0d7de; }
  .otv-tab { background: transparent; border: none; color: #8b949e; padding: 10px 14px; font-size: 13px; font-weight: 500; border-bottom: 2px solid transparent; margin-bottom: -1px; }
  .otv-root[data-theme="light"] .otv-tab { color: #59636e; }
  .otv-tab:hover { color: #e6edf3; }
  .otv-root[data-theme="light"] .otv-tab:hover { color: #1f2328; }
  .otv-tab.active { color: #58a6ff; border-bottom-color: #58a6ff; }

  /* Scroll area */
  .otv-scroll { padding: 20px 24px 60px; max-width: 1280px; }

  /* Turn */
  .otv-turn { margin-bottom: 14px; border: 1px solid #30363d; border-radius: 8px; background: #161b22; overflow: hidden; }
  .otv-root[data-theme="light"] .otv-turn { border-color: #d0d7de; background: #ffffff; }
  .otv-turn-header { display: flex; align-items: center; gap: 10px; padding: 8px 12px; background: #1c232c; border-bottom: 1px solid #21262d; font-size: 12px; color: #8b949e; cursor: pointer; user-select: none; }
  .otv-root[data-theme="light"] .otv-turn-header { background: #f0f3f6; border-bottom-color: #e4e8ed; color: #59636e; }
  .otv-turn-header .otv-idx { background: rgba(88,166,255,0.15); color: #58a6ff; padding: 1px 7px; border-radius: 10px; font-weight: 600; font-size: 11px; }
  .otv-turn-header .otv-role { font-weight: 600; }
  .otv-turn-header .otv-role-user { color: #79c0ff; }
  .otv-turn-header .otv-role-assistant { color: #7ee787; }
  .otv-turn-header .otv-role-system { color: #d2a8ff; }
  .otv-turn-header .otv-role-tool { color: #ffa657; }
  .otv-turn-header .otv-ts { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 11px; color: #6e7681; }
  .otv-turn-header .otv-tok { margin-left: auto; display: flex; gap: 6px; flex-wrap: wrap; }
  .otv-turn-header .otv-chip { background: #0d1117; border: 1px solid #30363d; padding: 1px 6px; border-radius: 8px; font-size: 10.5px; color: #8b949e; font-family: ui-monospace, monospace; }
  .otv-root[data-theme="light"] .otv-turn-header .otv-chip { background: #ffffff; border-color: #d0d7de; }
  .otv-turn-header .otv-chip.otv-tok-in { color: #58a6ff; }
  .otv-turn-header .otv-chip.otv-tok-out { color: #7ee787; }
  .otv-turn-header .otv-chip.otv-tok-cr { color: #d2a8ff; }
  .otv-turn-header .otv-chip.otv-tok-tool { color: #ffa657; }
  .otv-turn-header .otv-caret { margin-left: 6px; color: #6e7681; transition: transform 0.15s; }
  .otv-turn.collapsed .otv-turn-header .otv-caret { transform: rotate(-90deg); }
  .otv-turn.collapsed .otv-turn-body { display: none; }
  .otv-turn-body { padding: 14px 16px; }

  /* Block */
  .otv-block { margin: 8px 0; border-radius: 5px; border: 1px solid #21262d; overflow: hidden; }
  .otv-root[data-theme="light"] .otv-block { border-color: #e4e8ed; }
  .otv-block-header { padding: 5px 10px; background: #1c232c; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #8b949e; font-weight: 600; display: flex; align-items: center; gap: 6px; }
  .otv-root[data-theme="light"] .otv-block-header { background: #f0f3f6; color: #59636e; }
  .otv-block-content { padding: 10px 12px; overflow-x: auto; }
  .otv-block-content pre { font-size: 12.5px; }
  .otv-block.user { border-color: rgba(56,139,253,0.30); }
  .otv-block.user .otv-block-header { background: rgba(56,139,253,0.10); color: #79c0ff; }
  .otv-block.assistant { border-color: rgba(46,160,67,0.30); }
  .otv-block.assistant .otv-block-header { background: rgba(46,160,67,0.08); color: #7ee787; }
  .otv-block.tool { border-color: rgba(210,153,34,0.30); }
  .otv-block.tool .otv-block-header { background: rgba(210,153,34,0.10); color: #ffa657; }
  .otv-block.system { border-color: rgba(139,92,246,0.30); }
  .otv-block.system .otv-block-header { background: rgba(139,92,246,0.10); color: #d2a8ff; }
  .otv-block.thinking .otv-block-content { color: #8b949e; font-style: italic; }

  /* Tool call */
  .otv-tool-call { margin: 8px 0; padding: 10px 12px; background: #1c232c; border-left: 3px solid #ffa657; border-radius: 5px; }
  .otv-root[data-theme="light"] .otv-tool-call { background: #f0f3f6; }
  .otv-tool-call .otv-tool-name { font-weight: 600; color: #ffa657; font-size: 13px; font-family: ui-monospace, monospace; }
  .otv-tool-call .otv-tool-id { font-family: ui-monospace, monospace; font-size: 11px; color: #6e7681; margin-left: 8px; }
  .otv-tool-call .otv-tool-args { margin-top: 6px; background: #0d1117; border: 1px solid #21262d; border-radius: 5px; padding: 8px 10px; font-family: ui-monospace, monospace; font-size: 12px; white-space: pre-wrap; word-break: break-word; max-height: 360px; overflow: auto; }
  .otv-root[data-theme="light"] .otv-tool-call .otv-tool-args { background: #ffffff; border-color: #e4e8ed; }

  /* System prompt */
  .otv-sys-section { border: 1px solid #30363d; border-radius: 8px; margin-bottom: 10px; background: #161b22; overflow: hidden; }
  .otv-root[data-theme="light"] .otv-sys-section { border-color: #d0d7de; background: #ffffff; }
  .otv-sys-header { padding: 10px 14px; background: #1c232c; border-bottom: 1px solid #21262d; display: flex; align-items: center; gap: 10px; cursor: pointer; user-select: none; }
  .otv-root[data-theme="light"] .otv-sys-header { background: #f0f3f6; border-bottom-color: #e4e8ed; }
  .otv-sys-header .otv-sys-title { font-weight: 600; font-size: 13px; }
  .otv-sys-header .otv-type-badge { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; padding: 2px 7px; border-radius: 10px; background: rgba(88,166,255,0.15); color: #58a6ff; font-weight: 600; }
  .otv-sys-header .otv-type-badge.skills { background: rgba(210,153,34,0.15); color: #ffa657; }
  .otv-sys-header .otv-type-badge.agents_md { background: rgba(139,92,246,0.15); color: #d2a8ff; }
  .otv-sys-header .otv-type-badge.text { background: transparent; color: #8b949e; border: 1px solid #30363d; }
  .otv-sys-header .otv-sys-meta { margin-left: auto; font-size: 11px; color: #8b949e; font-family: ui-monospace, monospace; }
  .otv-sys-header .otv-caret { color: #6e7681; transition: transform 0.15s; }
  .otv-sys-section.collapsed .otv-sys-header .otv-caret { transform: rotate(-90deg); }
  .otv-sys-section.collapsed .otv-sys-body { display: none; }
  .otv-sys-body { padding: 12px 14px; font-size: 12.5px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; max-height: 70vh; overflow-y: auto; }
  .otv-skill-item { border-top: 1px solid #21262d; padding: 10px 0; }
  .otv-root[data-theme="light"] .otv-skill-item { border-top-color: #e4e8ed; }
  .otv-skill-item:first-child { border-top: none; padding-top: 0; }
  .otv-skill-item .otv-skill-name { font-weight: 600; color: #ffa657; font-size: 13px; font-family: ui-monospace, monospace; }
  .otv-skill-item .otv-skill-loc { font-family: ui-monospace, monospace; font-size: 11px; color: #6e7681; margin-left: 8px; word-break: break-all; }
  .otv-skill-item .otv-skill-desc { color: #8b949e; font-size: 12px; margin-top: 4px; line-height: 1.5; }
  .otv-root[data-theme="light"] .otv-skill-item .otv-skill-desc { color: #59636e; }

  /* Tools panel */
  .otv-tool-def { border: 1px solid #30363d; border-radius: 8px; margin-bottom: 8px; background: #161b22; overflow: hidden; }
  .otv-root[data-theme="light"] .otv-tool-def { border-color: #d0d7de; background: #ffffff; }
  .otv-tool-def-header { padding: 10px 14px; background: #1c232c; cursor: pointer; display: flex; align-items: center; gap: 10px; }
  .otv-root[data-theme="light"] .otv-tool-def-header { background: #f0f3f6; }
  .otv-tool-def-header .otv-tool-name { font-weight: 600; color: #ffa657; font-size: 13px; font-family: ui-monospace, monospace; }
  .otv-tool-def-header .otv-tool-desc { color: #8b949e; font-size: 12px; margin-left: 6px; }
  .otv-root[data-theme="light"] .otv-tool-def-header .otv-tool-desc { color: #59636e; }
  .otv-tool-def-body { padding: 12px 14px; font-family: ui-monospace, monospace; font-size: 12px; white-space: pre-wrap; word-break: break-word; }

  /* Stats grid */
  .otv-stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
  .otv-stat-card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 14px 16px; }
  .otv-root[data-theme="light"] .otv-stat-card { background: #ffffff; border-color: #d0d7de; }
  .otv-stat-card .otv-stat-label { color: #6e7681; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
  .otv-stat-card .otv-stat-value { font-weight: 700; font-size: 22px; margin-top: 6px; }
  .otv-stat-card .otv-stat-sub { color: #8b949e; font-size: 12px; margin-top: 4px; }
  .otv-root[data-theme="light"] .otv-stat-card .otv-stat-sub { color: #59636e; }

  /* Bar chart */
  .otv-bar-chart { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 14px 16px; margin-top: 14px; }
  .otv-root[data-theme="light"] .otv-bar-chart { background: #ffffff; border-color: #d0d7de; }
  .otv-bar-chart h3 { margin: 0 0 10px; font-size: 13px; }
  .otv-bar-row { display: grid; grid-template-columns: 50px 1fr 130px; align-items: center; gap: 8px; margin: 6px 0; font-size: 11.5px; color: #8b949e; }
  .otv-bar-row .otv-bar-label { font-family: ui-monospace, monospace; }
  .otv-bar-row .otv-bar-track { height: 12px; background: #1c232c; border-radius: 6px; overflow: hidden; display: flex; }
  .otv-root[data-theme="light"] .otv-bar-row .otv-bar-track { background: #f0f3f6; }
  .otv-bar-row .otv-bar-in { background: #58a6ff; height: 100%; }
  .otv-bar-row .otv-bar-out { background: #7ee787; height: 100%; }
  .otv-bar-row .otv-bar-cr { background: #d2a8ff; height: 100%; }
  .otv-bar-row .otv-bar-val { text-align: right; font-family: ui-monospace, monospace; color: #8b949e; }
  .otv-legend { display: flex; gap: 14px; font-size: 11px; color: #8b949e; margin: 6px 0 10px; }
  .otv-legend-dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 4px; vertical-align: middle; }

  /* Empty */
  .otv-empty { display: flex; align-items: center; justify-content: center; color: #8b949e; padding: 40px 0; }
  `;

  // ---------- Helpers ----------
  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
  function el(tag, props, children) {
    const e = document.createElement(tag);
    if (props) {
      for (const k of Object.keys(props)) {
        if (k === "class") e.className = props[k];
        else if (k === "html") e.innerHTML = props[k];
        else if (k === "text") e.textContent = props[k];
        else if (k.startsWith("on") && typeof props[k] === "function") e.addEventListener(k.slice(2), props[k]);
        else if (k === "data") for (const dk of Object.keys(props[k])) e.dataset[dk] = props[k][dk];
        else if (props[k] !== undefined && props[k] !== null) e.setAttribute(k, props[k]);
      }
    }
    for (const c of [].concat(children || [])) {
      if (c == null || c === false) continue;
      e.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
    }
    return e;
  }
  function fmtNum(n) {
    if (n == null) return "—";
    return Number(n).toLocaleString();
  }
  function fmtShort(n) {
    if (n == null) return "—";
    if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
    return String(n);
  }
  function fmtDate(iso) {
    if (!iso) return "—";
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  }
  function fmtTime(iso) {
    if (!iso) return "—";
    try { return new Date(iso).toLocaleTimeString(); } catch { return iso; }
  }

  // ---------- JSONL extraction ----------
  function extractJSONL(doc) {
    if (doc.lastChild && doc.lastChild.nodeType === Node.COMMENT_NODE && doc.lastChild.data.trim()) {
      return doc.lastChild.data.split(/\r?\n/).filter(Boolean);
    }
    return [];
  }
  function safeParse(line) {
    try { return JSON.parse(line); } catch { return { _parse_error: line }; }
  }

  // ---------- Data normalization ----------
  function unstar(obj) {
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      const out = {};
      for (const k of Object.keys(obj)) out[k.replace(/^\*/, "")] = unstar(obj[k]);
      return out;
    }
    if (Array.isArray(obj)) return obj.map(unstar);
    return obj;
  }
  function extractSystemText(field) {
    if (!field) return "";
    if (typeof field === "string") return field;
    if (Array.isArray(field)) {
      return field
        .map((s) => (s && typeof s === "object" ? s.text || s.content || "" : s || ""))
        .filter(Boolean)
        .join("\n\n");
    }
    return String(field);
  }
  function getDelta(obj, key) {
    return obj[key] ?? obj[`${key}+`] ?? obj[`${key}-`] ?? obj[`*${key}`];
  }
  function getMsgText(c) {
    if (c == null) return "";
    if (typeof c === "string") return c;
    if (!Array.isArray(c)) return JSON.stringify(c);
    const r = [];
    for (const b of c) {
      if (b && typeof b === "object") {
        const t = b.type;
        if (t === "text" || t === "input_text" || t === "output_text" || t === "summary_text") r.push(b.text || "");
        else if (t === "tool_use" || t === "function_call") r.push(`[${t}: ${b.name || ""}]`);
        else if (t === "tool_result" || t === "function_call_output") {
          const out = typeof b.content === "string" ? b.content : typeof b.output === "string" ? b.output : JSON.stringify(b.content || b.output || "");
          r.push(`[${t}: ${out.slice(0, 200)}]`);
        } else r.push(`[${t || "?"}]`);
      } else if (typeof b === "string") r.push(b);
    }
    return r.join("\n");
  }

  // ---------- Build conversation model ----------
  function buildModel(events) {
    const meta = { events: events.length, firstUser: null, request: null, errors: [], tools: [] };
    const turns = [];
    let lastUsage = null;
    let totalIn = 0, totalOut = 0, totalCR = 0, totalCC = 0;
    let toolCalls = 0;
    let earliest = null, latest = null;
    for (const raw of events) {
      const e = unstar(raw) || {};
      const ts = e._ts;
      if (ts) { if (!earliest || ts < earliest) earliest = ts; if (!latest || ts > latest) latest = ts; }
      if (e._kind === "request") {
        const sysText = extractSystemText(e.system);
        const msgs = e.messages || e.input || [];
        const isMeta = e._purpose === "[meta]";
        if (!isMeta && !meta.request) {
          meta.request = {
            model: e.model,
            temperature: e.temperature,
            max_tokens: e.max_tokens,
            url: e._url,
            purpose: e._purpose,
            system_chars: sysText.length,
            tools_count: (e.tools || []).length,
            tools: e.tools || [],
            messages: msgs,
          };
          if (!meta.tools.length && meta.request.tools.length) meta.tools = meta.request.tools;
        }
        if (!meta.firstUser) {
          for (const m of msgs) {
            if (m && m.role === "user") {
              const t = getMsgText(m.content);
              if (t && t.trim() !== "Generate a title for this conversation:") { meta.firstUser = t; break; }
            }
          }
        }
        lastUsage = null;
      } else if (e._kind === "response") {
        const u = e.usage || {};
        const inp = u.input_tokens || u.prompt_tokens || 0;
        const out = u.output_tokens || u.completion_tokens || 0;
        const cr = u.cache_read_input_tokens || 0;
        const cc = u.cache_creation_input_tokens || 0;
        if (inp || out || cr || cc) {
          lastUsage = { input_tokens: inp, output_tokens: out, cache_read_input_tokens: cr, cache_creation_input_tokens: cc };
          totalIn += inp; totalOut += out; totalCR += cr; totalCC += cc;
        }
        const content = e.content || e.output || getDelta(e, "output") || getDelta(e, "content");
        const arr = Array.isArray(content) ? content : (content ? [{ type: "text", text: typeof content === "string" ? content : JSON.stringify(content) }] : []);
        const text = arr.filter((c) => c && c.type === "text").map((c) => c.text || "").join("\n");
        const thinking = arr.filter((c) => c && c.type === "thinking").map((c) => c.thinking || c.text || "").join("\n");
        const tUses = [];
        for (const c of arr) {
          if (c && (c.type === "tool_use" || c.type === "function_call")) {
            tUses.push({ id: c.id, name: c.name, input: c.input ?? (c.arguments ? safeParseArgs(c.arguments) : null) });
            toolCalls++;
          }
        }
        turns.push({
          ts,
          usage: lastUsage,
          text,
          thinking,
          tool_uses: tUses,
          stop_reason: e.stop_reason || (e.choices && e.choices[0] && e.choices[0].finish_reason) || null,
          model: e.model || (meta.request && meta.request.model),
        });
        lastUsage = null;
      } else if (e._kind === "error") {
        meta.errors.push({ ts, error: e._error || String(e), stack: e._stack });
      }
    }
    meta.stats = {
      total_events: events.length,
      total_input_tokens: totalIn,
      total_output_tokens: totalOut,
      total_cache_read_tokens: totalCR,
      total_cache_creation_tokens: totalCC,
      tool_call_count: toolCalls,
      turn_count: turns.length,
      error_count: meta.errors.length,
      earliest_ts: earliest,
      latest_ts: latest,
    };
    return { meta, turns };
  }
  function safeParseArgs(s) {
    if (typeof s !== "string") return s;
    try { return JSON.parse(s); } catch { return s; }
  }

  // ---------- System prompt splitter ----------
  function splitSystem(text) {
    if (!text) return [];
    const out = [];
    const skillsMatch = text.match(/<available_skills>[\s\S]*?<\/available_skills>/);
    if (skillsMatch) {
      const before = text.slice(0, skillsMatch.index);
      const skillsText = skillsMatch[0];
      const after = text.slice(skillsMatch.index + skillsText.length);
      if (before.trim()) out.push(...splitByHeaders(before));
      out.push({ type: "skills", title: `Available Skills (${parseSkills(skillsText).length})`, char_count: skillsText.length, skills: parseSkills(skillsText) });
      if (after.trim()) out.push(...splitByHeaders(after));
      return out;
    }
    return splitByHeaders(text);
  }
  function parseSkills(s) {
    const out = [];
    const re = /<skill>\s*<name>(.*?)<\/name>\s*<description>([\s\S]*?)<\/description>\s*<location>(.*?)<\/location>\s*<\/skill>/g;
    let m;
    while ((m = re.exec(s))) out.push({ name: m[1].trim(), description: m[2].trim(), location: m[3].trim() });
    return out;
  }
  function splitByHeaders(text) {
    const headers = [];
    const re = /^(# .+|## .+|# AGENTS\.MD.+)$/gm;
    let m;
    while ((m = re.exec(text))) headers.push({ start: m.index, title: m[1].replace(/^#+\s*/, "").trim() });
    if (!headers.length) return [{ type: "text", title: "System prompt", content: text, char_count: text.length }];
    const out = [];
    if (headers[0].start > 0) {
      const pre = text.slice(0, headers[0].start).trim();
      if (pre) out.push({ type: "text", title: "Preamble", content: pre, char_count: pre.length });
    }
    for (let i = 0; i < headers.length; i++) {
      const start = headers[i].start;
      const end = i + 1 < headers.length ? headers[i + 1].start : text.length;
      const chunk = text.slice(start, end).trim();
      const isAgents = /AGENTS/i.test(headers[i].title);
      out.push({ type: isAgents ? "agents_md" : "text", title: headers[i].title, content: chunk, char_count: chunk.length });
    }
    return out;
  }

  function setBodyBg(theme) {
    document.body.style.background = theme === "dark" ? "#0d1117" : "#f6f8fa";
  }

  // ---------- Enhanced UI ----------
  function renderEnhanced(model) {
    const root = document.createElement("div");
    root.className = "otv-root";
    root.dataset.theme = localStorage.getItem("opencode-trace-theme") || "dark";
    setBodyBg(root.dataset.theme);

    // Top bar
    const top = el("div", { class: "otv-topbar" }, [
      el("h1", {}, [el("span", { class: "otv-logo", text: "o" }), el("span", { text: "opencode-trace" })]),
      el("span", { class: "otv-meta" }, `${model.meta.stats.turn_count} turns · ${fmtNum(model.meta.stats.tool_call_count)} tools · ${fmtDate(model.meta.stats.earliest_ts)}`),
      el("span", { class: "otv-spacer" }),
      (() => {
        const g = el("div", { class: "otv-btn-group" });
        for (const m of [["enhanced", "Enhanced"], ["classic", "Classic"]]) {
          const b = el("button", { class: "otv-btn" + (getMode() === m[0] ? " active" : ""), type: "button", "data-mode": m[0] }, m[1]);
          b.addEventListener("click", () => setMode(m[0]));
          g.appendChild(b);
        }
        return g;
      })(),
      (() => {
        const b = el("button", { class: "otv-btn", type: "button", title: "Toggle theme" }, root.dataset.theme === "dark" ? "☀" : "☾");
        b.addEventListener("click", () => {
          const next = root.dataset.theme === "dark" ? "light" : "dark";
          root.dataset.theme = next;
          setBodyBg(next);
          localStorage.setItem("opencode-trace-theme", next);
          b.textContent = next === "dark" ? "☀" : "☾";
        });
        return b;
      })(),
    ]);
    root.appendChild(top);

    // Summary
    const s = model.meta.stats;
    const summary = el("div", { class: "otv-summary" });
    const left = el("div");
    left.appendChild(el("h2", {}, document.title || "opencode-trace session"));
    const parts = [];
    if (model.meta.request) {
      if (model.meta.request.model) parts.push("model: " + model.meta.request.model);
      if (model.meta.request.max_tokens) parts.push("max_tokens: " + model.meta.request.max_tokens);
    }
    if (s.earliest_ts) parts.push(`${fmtDate(s.earliest_ts)} → ${fmtTime(s.latest_ts)}`);
    left.appendChild(el("div", { class: "otv-sub" }, parts.join(" · ")));
    summary.appendChild(left);
    const stats = el("div", { class: "otv-stats" });
    stats.appendChild(stat("otv-in", "Input tok", fmtNum(s.total_input_tokens)));
    stats.appendChild(stat("otv-out", "Output tok", fmtNum(s.total_output_tokens)));
    if (s.total_cache_read_tokens) stats.appendChild(stat("otv-cache", "Cache read", fmtNum(s.total_cache_read_tokens)));
    stats.appendChild(stat("otv-tools", "Tool calls", fmtNum(s.tool_call_count)));
    stats.appendChild(stat("", "Turns", fmtNum(s.turn_count)));
    if (s.error_count) stats.appendChild(stat("otv-err", "Errors", fmtNum(s.error_count)));
    summary.appendChild(stats);
    root.appendChild(summary);

    // Tabs
    const tabs = el("div", { class: "otv-tabs" });
    const tabNames = ["conversation", "system", "tools", "usage", "raw"];
    for (const t of tabNames) {
      const b = el("button", { class: "otv-tab" + (t === "conversation" ? " active" : ""), type: "button", "data-tab": t }, capitalize(t));
      tabs.appendChild(b);
    }
    root.appendChild(tabs);
    const scroll = el("div", { class: "otv-scroll" });
    root.appendChild(scroll);

    // Tab switching
    tabs.addEventListener("click", (ev) => {
      const t = ev.target.closest(".otv-tab");
      if (!t) return;
      for (const b of tabs.querySelectorAll(".otv-tab")) b.classList.toggle("active", b === t);
      renderTab(scroll, t.dataset.tab, model);
    });

    // Default tab
    renderTab(scroll, "conversation", model);
    return root;
  }
  function stat(cls, label, value) {
    return el("div", { class: "otv-stat " + cls }, [
      el("div", { class: "otv-label" }, label),
      el("div", { class: "otv-value" }, value),
    ]);
  }
  function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function renderTab(host, name, model) {
    host.innerHTML = "";
    if (name === "conversation") return renderConversation(host, model);
    if (name === "system") return renderSystem(host, model);
    if (name === "tools") return renderTools(host, model);
    if (name === "usage") return renderUsage(host, model);
    if (name === "raw") return renderRaw(host, model);
  }
  function renderConversation(host, model) {
    if (model.meta.firstUser) {
      const intro = el("div", { class: "otv-turn" }, [
        el("div", { class: "otv-turn-header" }, [
          el("span", { class: "otv-idx" }, "▶"),
          el("span", { class: "otv-role otv-role-user" }, "Initial user prompt"),
          el("span", { class: "otv-ts" }, fmtTime(model.meta.stats.earliest_ts)),
        ]),
        el("div", { class: "otv-turn-body" }, [
          block("user", "user message", model.meta.firstUser),
        ]),
      ]);
      host.appendChild(intro);
    }
    if (!model.turns.length) {
      host.appendChild(el("div", { class: "otv-empty" }, "No turns found."));
      return;
    }
    model.turns.forEach((t, i) => {
      const turn = el("div", { class: "otv-turn collapsed" });
      const header = el("div", { class: "otv-turn-header" });
      header.appendChild(el("span", { class: "otv-idx" }, String(i + 1)));
      header.appendChild(el("span", { class: "otv-role otv-role-assistant" }, "Assistant"));
      header.appendChild(el("span", { class: "otv-ts" }, fmtTime(t.ts)));
      const tok = el("span", { class: "otv-tok" });
      const u = t.usage || {};
      if (u.input_tokens) tok.appendChild(el("span", { class: "otv-chip otv-tok-in" }, "in " + fmtShort(u.input_tokens)));
      if (u.output_tokens) tok.appendChild(el("span", { class: "otv-chip otv-tok-out" }, "out " + fmtShort(u.output_tokens)));
      if (u.cache_read_input_tokens) tok.appendChild(el("span", { class: "otv-chip otv-tok-cr" }, "cache " + fmtShort(u.cache_read_input_tokens)));
      if (t.tool_uses && t.tool_uses.length) tok.appendChild(el("span", { class: "otv-chip otv-tok-tool" }, t.tool_uses.length + " tool" + (t.tool_uses.length > 1 ? "s" : "")));
      if (t.stop_reason) tok.appendChild(el("span", { class: "otv-chip" }, t.stop_reason));
      header.appendChild(tok);
      header.appendChild(el("span", { class: "otv-caret" }, "▾"));
      header.addEventListener("click", () => turn.classList.toggle("collapsed"));
      turn.appendChild(header);
      const body = el("div", { class: "otv-turn-body" });
      if (t.thinking) body.appendChild(block("thinking", "thinking", t.thinking));
      if (t.text) body.appendChild(block("assistant", "assistant text", t.text));
      for (const tu of t.tool_uses || []) {
        const tc = el("div", { class: "otv-tool-call" });
        tc.appendChild(el("div", {}, [
          el("span", { class: "otv-tool-name" }, "→ " + (tu.name || "tool")),
          tu.id ? el("span", { class: "otv-tool-id" }, tu.id) : null,
        ]));
        tc.appendChild(el("pre", { class: "otv-tool-args" }, JSON.stringify(tu.input, null, 2)));
        body.appendChild(tc);
      }
      if (!t.text && !t.thinking && !(t.tool_uses && t.tool_uses.length)) {
        body.appendChild(block("", "(empty)", ""));
      }
      turn.appendChild(body);
      host.appendChild(turn);
    });
    if (model.meta.errors.length) {
      host.appendChild(el("h3", { style: "margin-top: 30px; color: #ff7b72;" }, "Errors"));
      for (const err of model.meta.errors) {
        host.appendChild(block("", "error @ " + fmtTime(err.ts), err.error || ""));
      }
    }
  }
  function block(cls, header, content) {
    const b = el("div", { class: "otv-block " + cls });
    b.appendChild(el("div", { class: "otv-block-header" }, header));
    if (content != null && content !== "") {
      const c = el("div", { class: "otv-block-content" });
      c.appendChild(el("pre", {}, content));
      b.appendChild(c);
    }
    return b;
  }
  function renderSystem(host, model) {
    const sysText = (model.meta.request && extractSystemText(model.meta.request.system)) || (model.meta.events && "");
    // Try to derive system from the first request's `system` field if available in events
    let actualSys = "";
    for (const ev of (model.meta.eventsList || [])) {
      // events not preserved; we used meta.request.system_chars above. Read from DOM later if needed.
    }
    // Rebuild from stored text - we don't have it in meta; instead, scan model for any system text.
    // Simpler: ask the raw events from globals? Fallback to the first non-empty from the underlying data.
    actualSys = model._systemText || "";
    if (!actualSys) {
      host.appendChild(el("div", { class: "otv-empty" }, "No system prompt in this log."));
      return;
    }
    const secs = splitSystem(actualSys);
    const totalChars = secs.reduce((a, s) => a + (s.char_count || 0), 0);
    const head = el("div", { style: "margin-bottom: 14px; display: flex; align-items: center; gap: 8px;" }, [
      el("h3", { style: "margin: 0;" }, "System prompt"),
      el("span", { class: "otv-chip", style: "background: #1c232c; border: 1px solid #30363d; padding: 2px 8px; border-radius: 10px; color: #8b949e; font-size: 11px;" }, fmtShort(totalChars) + " chars · " + secs.length + " sections"),
    ]);
    host.appendChild(head);
    for (const s of secs) {
      const sec = el("div", { class: "otv-sys-section collapsed" });
      const h = el("div", { class: "otv-sys-header" });
      h.appendChild(el("span", { class: "otv-type-badge " + (s.type || "text") }, s.type || "text"));
      h.appendChild(el("span", { class: "otv-sys-title" }, s.title || ""));
      h.appendChild(el("span", { class: "otv-sys-meta" }, fmtShort(s.char_count) + " chars"));
      h.appendChild(el("span", { class: "otv-caret" }, "▾"));
      h.addEventListener("click", () => sec.classList.toggle("collapsed"));
      sec.appendChild(h);
      const body = el("div", { class: "otv-sys-body" });
      if (s.type === "skills" && s.skills) {
        for (const sk of s.skills) {
          const it = el("div", { class: "otv-skill-item" });
          it.appendChild(el("div", {}, [el("span", { class: "otv-skill-name" }, sk.name), el("span", { class: "otv-skill-loc" }, sk.location)]));
          it.appendChild(el("div", { class: "otv-skill-desc" }, sk.description));
          body.appendChild(it);
        }
      } else if (s.content) body.textContent = s.content;
      sec.appendChild(body);
      host.appendChild(sec);
    }
  }
  function renderTools(host, model) {
    const tools = (model.meta.request && model.meta.request.tools) || [];
    if (!tools.length) { host.appendChild(el("div", { class: "otv-empty" }, "No tools declared in this log.")); return; }
    host.appendChild(el("h3", { style: "margin-top: 0;" }, "Tools (" + tools.length + ")"));
    for (const t of tools) {
      const d = el("div", { class: "otv-tool-def" });
      const h = el("div", { class: "otv-tool-def-header" });
      h.appendChild(el("span", { class: "otv-tool-name" }, t.name || "(unnamed)"));
      h.appendChild(el("span", { class: "otv-tool-desc" }, t.description || ""));
      d.appendChild(h);
      const body = el("div", { class: "otv-tool-def-body" });
      body.textContent = JSON.stringify(t.input_schema || t.parameters || {}, null, 2);
      d.appendChild(body);
      host.appendChild(d);
    }
  }
  function renderUsage(host, model) {
    const s = model.meta.stats;
    const grid = el("div", { class: "otv-stat-grid" });
    grid.appendChild(statCard("Total input tokens", fmtNum(s.total_input_tokens), s.total_cache_read_tokens ? fmtNum(s.total_cache_read_tokens) + " from cache" : ""));
    grid.appendChild(statCard("Total output tokens", fmtNum(s.total_output_tokens), "across " + s.turn_count + " responses"));
    grid.appendChild(statCard("Cache read tokens", fmtNum(s.total_cache_read_tokens), "reused from prior turns"));
    grid.appendChild(statCard("Cache creation", fmtNum(s.total_cache_creation_tokens), "fresh prompt cache"));
    grid.appendChild(statCard("Tool calls", fmtNum(s.tool_call_count), ""));
    grid.appendChild(statCard("Errors", fmtNum(s.error_count), ""));
    grid.appendChild(statCard("Total events", fmtNum(s.total_events), "raw JSONL events"));
    host.appendChild(grid);

    if (model.turns.length) {
      const chart = el("div", { class: "otv-bar-chart" });
      chart.appendChild(el("h3", {}, "Per-turn token usage"));
      const legend = el("div", { class: "otv-legend" });
      legend.innerHTML = '<span><span class="otv-legend-dot" style="background:#58a6ff;"></span> input</span><span><span class="otv-legend-dot" style="background:#d2a8ff;"></span> cache_read</span><span><span class="otv-legend-dot" style="background:#7ee787;"></span> output</span>';
      chart.appendChild(legend);
      const maxV = Math.max(1, ...model.turns.map((t) => (t.usage && t.usage.input_tokens || 0) + (t.usage && t.usage.cache_read_input_tokens || 0)));
      model.turns.forEach((t, i) => {
        const u = t.usage || {};
        const inp = u.input_tokens || 0, out = u.output_tokens || 0, cr = u.cache_read_input_tokens || 0;
        const row = el("div", { class: "otv-bar-row" });
        row.appendChild(el("div", { class: "otv-bar-label" }, "#" + (i + 1)));
        const track = el("div", { class: "otv-bar-track" });
        const inEl = el("div", { class: "otv-bar-in" }); inEl.style.width = ((inp / maxV) * 100) + "%";
        const crEl = el("div", { class: "otv-bar-cr" }); crEl.style.width = ((cr / maxV) * 100) + "%";
        const outEl = el("div", { class: "otv-bar-out" }); outEl.style.width = ((out / maxV) * 100) + "%";
        track.appendChild(inEl); track.appendChild(crEl); track.appendChild(outEl);
        row.appendChild(track);
        row.appendChild(el("div", { class: "otv-bar-val" }, `in ${fmtShort(inp)} · cr ${fmtShort(cr)} · out ${fmtShort(out)}`));
        chart.appendChild(row);
      });
      host.appendChild(chart);
    }

    if (model._systemSections && model._systemSections.length) {
      const chart = el("div", { class: "otv-bar-chart" });
      chart.appendChild(el("h3", {}, "System prompt sections (by char count)"));
      const totalChars = model._systemSections.reduce((a, s) => a + (s.char_count || 0), 0);
      const maxC = Math.max(1, ...model._systemSections.map((s) => s.char_count || 0));
      for (const sec of model._systemSections) {
        const row = el("div", { class: "otv-bar-row" });
        row.appendChild(el("div", { class: "otv-bar-label", title: sec.title }, (sec.title || sec.type || "").slice(0, 30)));
        const track = el("div", { class: "otv-bar-track" });
        const inEl = el("div", { class: "otv-bar-in" });
        inEl.style.width = ((sec.char_count / maxC) * 100) + "%";
        track.appendChild(inEl);
        row.appendChild(track);
        const pct = totalChars ? ((sec.char_count / totalChars) * 100).toFixed(1) : "0";
        row.appendChild(el("div", { class: "otv-bar-val" }, `${fmtShort(sec.char_count)} (${pct}%)`));
        chart.appendChild(row);
      }
      host.appendChild(chart);
    }
  }
  function statCard(label, value, sub) {
    return el("div", { class: "otv-stat-card" }, [
      el("div", { class: "otv-stat-label" }, label),
      el("div", { class: "otv-stat-value" }, value),
      sub ? el("div", { class: "otv-stat-sub" }, sub) : null,
    ]);
  }
  function renderRaw(host, model) {
    host.appendChild(el("h3", { style: "margin-top: 0;" }, "Raw events (" + model.meta.events.length + ")"));
    // The events were parsed from the comment; we have the count but not the lines anymore.
    // Fall back to a re-parse from the document.
    const lines = extractJSONL(document);
    lines.forEach((line, i) => {
      const obj = safeParse(line);
      const det = document.createElement("details");
      const sum = document.createElement("summary");
      const kind = obj._kind || "?";
      sum.textContent = `[${i}] ${kind}${obj._purpose ? " · " + obj._purpose : ""} · ${obj._ts || ""}`;
      det.appendChild(sum);
      const pre = document.createElement("pre");
      pre.style.cssText = "margin:4px 0 4px 12px; padding:8px 10px; background:#0d1117; border-left:2px solid #30363d; white-space:pre-wrap; word-break:break-word;";
      pre.textContent = JSON.stringify(obj, null, 2);
      det.appendChild(pre);
      host.appendChild(det);
    });
  }

  // ---------- Classic tree (legacy) ----------
  // Mirror of the original viewer.js tree renderer, kept verbatim under window.buildNode.
  function fromHTML(html) {
    const t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }
  function treeEsc(s) {
    s = String(s == null ? "" : s);
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br/>").replace(/\\n/g, "<br/>");
  }
  function treeTs(d) { return (d && d._ts ? d._ts.slice(11, 19) : "?"); }
  function treeShort(s) { return String(s == null ? "" : s).replace(/\n/g, " ").slice(0, 80); }
  function treeContent(contents) {
    if (typeof contents === "string") return contents;
    if (!Array.isArray(contents)) return JSON.stringify(contents == null ? "" : contents);
    const r = [];
    for (const c of contents) {
      const t = c && typeof c === "object" ? c.type : undefined;
      const text = c && typeof c === "object" ? c.text : c;
      if (t === "input_text" || t === "output_text" || t === "text") r.push(String(text == null ? "" : text));
      else r.push("[" + String(t == null ? "?" : t) + "]");
    }
    return r.join("\n");
  }
  function treeRenderPayload(elements) {
    if (!Array.isArray(elements)) return [];
    const out = [];
    for (const e of elements) {
      if (e === "...") out.push({ [TITLE]: "Added..." });
      else if (e === "---") out.push({ [TITLE]: "Removed..." });
      else if (e.type === "message" || (e.type === undefined && e.role !== undefined && e.content !== undefined)) {
        out.push({ [TITLE]: out.length + ": message(" + treeEsc(e.role) + "): ", [INLINE]: treeEsc(treeShort(treeContent(e.content))), body: treeContent(e.content) });
      } else if (e.type === "input_text" || e.type === "output_text" || e.type === "text") {
        out.push({ [TITLE]: out.length + ": " + e.type + ": ", [INLINE]: treeEsc(treeShort(String(e.text == null ? "" : e.text))), body: e.text });
      } else if (e.type === "function_call_output" || e.type === "tool_result") {
        const result = e.type === "function_call_output"
          ? (typeof e.output === "string" ? e.output : JSON.stringify(e.output == null ? "" : e.output))
          : (typeof e.content === "string" ? e.content : treeContent(e.content));
        out.push({ [TITLE]: out.length + ": ", [INLINE]: treeEsc(e.type) + ": " + treeEsc(treeShort(result)), body: e });
      } else if (e.type === "function_call" || e.type === "tool_use") {
        let arg = "";
        try {
          const raw = e.type === "function_call" ? JSON.parse(e.arguments) : e.input;
          const r = raw && (raw.cmd || raw.pattern || raw);
          arg = typeof r === "string" ? r : JSON.stringify(r == null ? "" : r);
        } catch { arg = "..."; }
        out.push({ [TITLE]: out.length + ": ", [INLINE]: treeEsc(e.type) + ": " + treeEsc(e.name || "???") + "(" + treeEsc(treeShort(arg)) + ")", body: e });
      } else {
        out.push({ [TITLE]: out.length + ": ", [INLINE]: treeEsc(e.type || "???"), body: e });
      }
    }
    return out;
  }
  function treeRender(data, label) {
    const deltaField = (k) => data[k] || data[k + "+"] || data[k + "-"] || data["*" + k];
    const id = data && data._id !== undefined ? " #" + treeEsc(String(data._id)) : "";
    const purpose = data && data._purpose ? " " + treeEsc(String(data._purpose)) : "";
    if (data && data[TITLE] !== undefined) return data;
    if (data && data._kind === "request") {
      const r = treeRenderPayload(deltaField("input") || deltaField("messages"));
      const raw = Object.assign({}, data); delete raw._kind;
      return { [TITLE]: "[" + treeEsc(treeTs(data)) + "] <b>REQUEST" + id + purpose + "</b> ", body: r.concat([{ [TITLE]: "raw", body: raw }]), open: true };
    }
    if (data && data._kind === "response") {
      const r = treeRenderPayload(deltaField("output") || deltaField("content"));
      const raw = Object.assign({}, data); delete raw._kind;
      return { [TITLE]: "[" + treeEsc(treeTs(data)) + "] <b>RESPONSE" + id + purpose + "</b> ", body: r.concat([{ [TITLE]: "raw", body: raw }]), open: true };
    }
    if (data && data._kind === "error") {
      const raw = Object.assign({}, data);
      return { [TITLE]: "[" + treeEsc(treeTs(data)) + "] <b>ERROR" + id + purpose + "</b> ", [INLINE]: treeEsc(treeShort(data._error)), body: [data._error || "???"].concat(data._stack ? [{ [TITLE]: "stack", body: data._stack }] : []).concat([{ [TITLE]: "raw", body: raw }]), open: true };
    }
    if (data && data._kind !== undefined && data._ts !== undefined) {
      const raw = Object.assign({}, data);
      return { [TITLE]: "[" + treeEsc(treeTs(data)) + "] <b>" + treeEsc(data._kind) + "</b> ", body: raw, open: true };
    }
    return {
      [TITLE]: treeEsc(label),
      [INLINE]: treeEsc(Array.isArray(data) ? "[..." + data.length + " items]" : "{" + Object.keys(data).map((k) => JSON.stringify(k) + ":").join(",") + "}"),
      body: data,
      numbered: true,
    };
  }
  function treeBuildNode(data, label) {
    if (data && typeof data === "object") {
      const r = treeRender(data, label);
      const d = fromHTML("<details><summary>" + r[TITLE] + "<output>" + (r[INLINE] || "") + "</output></summary></details>");
      d.addEventListener("toggle", () => {
        if (r.body === undefined) return;
        if (Array.isArray(r.body)) r.body.forEach((item, i) => d.appendChild(treeBuildNode(item, r.numbered ? i + 1 + ": " : "")));
        else if (r.body && typeof r.body === "object") Object.keys(r.body).forEach((k) => d.appendChild(treeBuildNode(r.body[k], JSON.stringify(k) + ": ")));
        else d.appendChild(treeBuildNode(r.body, ""));
      }, { once: true });
      d.open = r.open;
      return d;
    }
    return fromHTML("<div>" + treeEsc(label) + treeEsc(JSON.stringify(data)) + "</div>");
  }

  // Expose legacy tree for any inline fallback scripts.
  window.buildNode = treeBuildNode;

  // ---------- Mode switching ----------
  function getMode() {
    try {
      const m = localStorage.getItem(STORAGE_KEY);
      return m === "classic" ? "classic" : "enhanced";
    } catch { return DEFAULT_MODE; }
  }
  function setMode(m) {
    try { localStorage.setItem(STORAGE_KEY, m); } catch {}
    location.reload();
  }

  // ---------- Inject CSS once ----------
  function injectCSS() {
    if (document.getElementById("otv-styles")) return;
    const s = document.createElement("style");
    s.id = "otv-styles";
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  // ---------- Main entry ----------
  function init() {
    const lines = extractJSONL(document);
    if (!lines.length) return;
    const events = lines.map(safeParse);

    // Strip any previous body content the plugin might have rendered (e.g. classic tree nodes
    // from an earlier pass when window.buildNode was used).
    document.body.innerHTML = "";

    injectCSS();
    const mode = getMode();
    if (mode === "classic") {
      document.body.style.background = "#ffffff";
      // Render the legacy tree directly.
      for (const ev of events) {
        const node = treeBuildNode(ev, "json:");
        if (node) node.classList.add("log-entry");
        document.body.appendChild(node);
      }
      // Add a tiny floating toggle to switch back.
      const fab = document.createElement("button");
      fab.textContent = "Switch to Enhanced";
      fab.className = "otv-btn";
      fab.style.cssText = "position:fixed; right:14px; bottom:14px; z-index:99;";
      fab.addEventListener("click", () => setMode("enhanced"));
      document.body.appendChild(fab);
    } else {
      const model = buildModel(events);
      // Recover the full system text for the System tab. Skip "[meta]" requests
      // (e.g. the title-generator call) so we get the real conversation system prompt.
      let sysText = "";
      let sysSections = [];
      for (const raw of events) {
        const e = unstar(raw) || {};
        if (e._kind === "request" && e._purpose !== "[meta]") {
          const t = extractSystemText(e.system);
          if (t) { sysText = t; sysSections = splitSystem(t); break; }
        }
      }
      model._systemText = sysText;
      model._systemSections = sysSections;
      const ui = renderEnhanced(model);
      document.body.appendChild(ui);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
