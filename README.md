# claude-cost

Tiny Electron app that shows the API-equivalent cost of your Claude Code and Codex usage.

```sh
npm install
npm start
```

How it works (same approach as T3 Code's usage page):

1. **Claude Code:** reads `~/.claude/projects/**/*.jsonl` (or `$CLAUDE_CONFIG_DIR/projects`).
   Keeps `assistant` lines with `message.usage`, last line per `message.id:requestId`
   (earlier streaming lines carry partial `output_tokens`).
2. **Codex:** reads `~/.codex/sessions/**/*.jsonl` (or `$CODEX_HOME/sessions`).
   `token_count` events carry no model, so the model and service tier carry forward from
   the latest `turn_context` / `thread_settings_applied`. Drops repeated events and the
   parent history copied into forked/subagent rollouts.
3. Prices tokens with LiteLLM's `model_prices_and_context_window.json`: Claude fast-mode
   multiplier and 1h cache-write rates, Codex `priority`/`ultrafast` tiers and
   long-context rates (`*_above_<n>k_tokens`, read per model).

Dashboard: metric tiles, per-model area chart (hand-rolled SVG, monotone curves ported
from T3 Code, hover tooltip), cost/token share bars, model table. 7D/30D/90D/All and
Cost/Tokens toggles, an All/Claude/Codex filter, and a "Price as" switch
(Anthropic API, Bedrock global, Bedrock EU, Bedrock US) that re-prices Claude usage with
LiteLLM's Bedrock entries without rescanning. Regional Bedrock endpoints cost 10% more. No chart library.

Also: a Day/Hour toggle for the main chart (rolling last 48 hours, local time), a weekday x
hour-of-day heatmap, cost per project (from each transcript's `cwd`), the ten most expensive
sessions in the period, monthly totals with a month-to-date projection, a GitHub-style
calendar of the last 365 days, and a "Value vs plan" tile. Enter your own monthly plan prices
(stored in `localStorage`, nothing is assumed) and it compares API-equivalent cost to the plan
prorated over the selected period. Everything is filtered client-side from one aggregate, so
filters and re-pricing never rescan.

This is list-price cost, not what a subscription bills. Matches `npx ccusage claude daily` within cents and `npx ccusage codex monthly` within ~2%.

## Credits

Approach and chart design follow the usage page in [T3 Code](https://github.com/pingdotgg/t3code). Prices from [LiteLLM](https://github.com/BerriAI/litellm).

## License

MIT
