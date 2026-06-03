# opencode-trace

This opencode plugin lets you see the raw json requests made to the LLM, and the responses.
* Example: https://ljw1004.github.io/opencode-trace/example.html

## Installation

Add the package to your OpenCode config:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@ljw1004/opencode-trace"]
}
```

Restart OpenCode and you'll see each transcript stored in `~/opencode-trace`.

## Viewer

Open any trace `.html` file directly in a browser (works via `file://`). The viewer offers two modes:

### Enhanced Mode (default)
- **Conversation tab**: collapsible turn cards with per-turn token chips (input, output, cache), tool-use callouts, error highlights
- **System tab**: system prompt auto-split by sections (markdown headers, skill definitions); skills shown as structured list
- **Tools tab**: all tool declarations with JSON schema previews
- **Usage tab**: stat cards + per-turn bar charts + system-section breakdown
- **Raw tab**: full JSON tree per raw event
- **Dark/light theme** toggle (persisted)
- **Mode toggle** to switch between Enhanced and Classic views (persisted)

### Classic Mode
The original `<details>`-based tree renderer. Access via the mode toggle.

That installation path by default uses `@latest`, which opencode currently does't refresh when latest changes. You can force a refresh with `rm -rf ~/.cache/opencode/packages/@ljw1004/opencode-trace@latest`
