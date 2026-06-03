# opencode-trace

This is a plugin designed to capture the raw json requests sent to the LLM, and the raw responses back (after streaming-delta consolidation). It saves them into ~/opencode-trace

## Usage
- End users should install it as an npm plugin via `"plugin": ["@ljw1004/opencode-trace"]` in `~/.config/opencode/opencode.json`.
- Traces are interactive `.html` files in `~/opencode-trace/`. Open them directly in a browser (works via `file://`).

## Enhanced Viewer
The viewer (embedded inline in each trace HTML or loaded from a sibling `viewer.js`) offers two modes:

### Enhanced Mode (default)
- **Top bar**: session meta, mode toggle (Enhanced/Classic), theme toggle (dark/light)
- **Summary bar**: token counts (input, output, cache read), tool calls, turns, errors
- **Tabs**:
  - **Conversation**: collapsible turn cards with per-turn token chips (input/output/cache/ tools), tool-use callouts, error highlights
  - **System**: auto-split system prompt by markdown headers (`^#` / `^##`) and `<available_skills>` blocks; skills rendered as structured list with name, description, location
  - **Tools**: all declared tools with JSON schema previews
  - **Usage**: stat cards + per-turn bar chart (input/cache_read/output) + system-section bar chart (by char count)
  - **Raw**: collapsible JSON tree per raw event
- **LocalStorage persistence**: mode preference, theme preference

### Classic Mode
Legacy tree renderer (the original `<details>`-based tree). Access via the mode toggle in the top bar, or from the floating "Switch to Enhanced" button that appears in Classic mode.

## Development

```bash
npm install
npm run typecheck
npm run lint
```

- Change the plugin line to `["/path/to/opencode-trace/index.ts"]` in your opencode config.
- Exercise it: `opencode run --dangerously-skip-permissions "why is the sky blue?"`
- New traces will embed whatever `viewer.js` is current in the repo.

### Viewer iteration (no opencode restart needed)
1. Copy `viewer.js` into `~/opencode-trace/` — it will be loaded in preference to the embedded version
2. Refresh the trace HTML file in your browser to see changes instantly

### Testing the viewer
The viewer is tested with Playwright against real trace files. A test server is needed because Playwright doesn't support `file://`:

```bash
python3 -m http.server 8765 -d ~/opencode-trace
```

Then run test scripts that load `http://127.0.0.1:8765/<filename>.html` and verify tabs, turns, tools, etc. via Playwright selectors.

### Architecture
- `index.ts` (Node plugin): captures LLM request/response via fetch interception, writes traces as HTML with JSONL trailing comment
- `viewer.js`: standalone plain JS (no build step, no dependencies, no modules), read via `readFileSync` at trace-creation time and inlined in the HTML preamble
- CSS is injected via JS (`<style id="otv-styles">`) so the viewer works both embedded and as an external script
- JSONL is extracted from `document.lastChild` (`Node.COMMENT_NODE`), the trailing unterminated `<!--` comment

### Key implementation details
- Requests with `_purpose === "[meta]"` (title generation, etc.) are excluded from the main view (tools, system, firstUser)
- Streaming deltas are consolidated server-side in `index.ts` (SSE → JSON for Anthropic, OpenAI chat/responses formats)
- Classical mode defines `window.buildNode` for backward compatibility with the first-generation viewer

## Deployment
- Bump version in `package.json`
- `npm login`, `npm publish --dry-run`, `npm publish`
- Verify with `npm view "@ljw1004/opencode-trace"`
- Test by installing as described above