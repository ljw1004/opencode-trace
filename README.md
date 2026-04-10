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

That installation path by default uses `@latest`, which opencode currently does't refresh when latest changes. You can force a refresh with `rm -rf ~/.cache/opencode/packages/@ljw1004/opencode-trace@latest`
