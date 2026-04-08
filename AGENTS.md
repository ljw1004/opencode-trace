# opencode-trace

This is a plugin designed to capture the raw json requests sent to the LLM, and the raw responses back (after streaming-delta consolidation). It saves them into ~/opencode-trace
- For end-to-end build+install and testing: `npm run build` then `cp dist/opencode-trace.ts ~/.config/opencode/plugins/`, and then just run `opencode run --dangerously-skip-permissions "why is grass green?"` to test it. This will re-use the existing opencode API key / oauth credentials.
- For development, no build+install is needed. Undo the previous global install `rm ~/.config/opencode/plugins/opencode-trace.ts` and then `OPENCODE_CONFIG="/absolute/path/to/opencode-trace/integration-test.json" opencode run --dangerously-skip-permissions "why is the sky blue?"`
- For development: `npm install` once, then `npm run typecheck` or `npm run lint`
