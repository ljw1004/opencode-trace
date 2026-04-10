# opencode-trace

This is a plugin designed to capture the raw json requests sent to the LLM, and the raw responses back (after streaming-delta consolidation). It saves them into ~/opencode-trace
- End users should install it as an npm plugin via `"plugin": ["@ljw1004/opencode-trace"]` in `~/.config/opencode/opencode.json`.
- For development: `npm install` once, and change the plugin line to `["/path/to/opencode-trace/index.ts"]`. Then each time you edit, `npm run typecheck` and `npm run lint` and then exercise it `opencode run --dangerously-skip-permissions "why is the sky blue?"`. (It's using the existing opencode configuration to pick up your already-configured auth).
- For iterating on the viewer, you can copy `viewer.js` into your ~/opencode-trace directory, or copy examples into this directory, and they'll preferentially pick up `viewer.js` over their embedded viewer code.