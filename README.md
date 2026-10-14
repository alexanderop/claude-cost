# claude-cost

Tiny Electron app that shows the API-equivalent cost of your Claude Code usage.

```sh
npm install
npm start
```

How it works (same approach as T3 Code's usage page):

1. Reads `~/.claude/projects/**/*.jsonl` (or `$CLAUDE_CONFIG_DIR/projects`).
2. Keeps `assistant` lines with `message.usage`, last line per `message.id:requestId`
   (earlier streaming lines carry partial `output_tokens`).
3. Prices tokens with LiteLLM's `model_prices_and_context_window.json`, including
   fast-mode multiplier and 1h cache-write rates.

This is list-price cost, not what a subscription bills. Matches `npx ccusage daily` within cents.
