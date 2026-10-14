// Estimates API-equivalent cost from Claude Code transcripts, the way T3 Code does:
// local JSONL token counts × LiteLLM list prices. Not what a subscription bills.
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const readline = require('node:readline')

const PRICES_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'

// Bare family names are ambiguous across generations; <synthetic> was never billed.
const UNPRICEABLE = new Set(['<synthetic>', 'synthetic', 'opus', 'sonnet', 'haiku', 'fable'])

function claudeProjectsDir() {
  const home = process.env.CLAUDE_CONFIG_DIR?.trim() || path.join(os.homedir(), '.claude')
  return path.join(home, 'projects')
}

async function fetchPrices() {
  const res = await fetch(PRICES_URL)
  if (!res.ok) throw new Error(`LiteLLM prices: HTTP ${res.status}`)
  return res.json()
}

function lookupRate(prices, model) {
  const key = model.trim().toLowerCase().split('[')[0]
  if (UNPRICEABLE.has(key)) return null
  const p = prices[key]
  if (typeof p?.input_cost_per_token !== 'number' || typeof p?.output_cost_per_token !== 'number') {
    return null
  }
  return p
}

// Cost of one response split by token category, plus what cache reads saved.
function priceUsage(rate, u) {
  const mult = u.speed === 'fast' ? (rate.provider_specific_entry?.fast ?? 1) : 1
  const input = rate.input_cost_per_token * mult
  const cacheRead = (rate.cache_read_input_token_cost ?? rate.input_cost_per_token) * mult
  const write5m = (rate.cache_creation_input_token_cost ?? rate.input_cost_per_token) * mult
  const write1h = (rate.cache_creation_input_token_cost_above_1hr ?? rate.cache_creation_input_token_cost ?? rate.input_cost_per_token) * mult
  // 1h cache writes bill at a higher rate than the default 5m ones.
  const write1hTokens = u.cache_creation?.ephemeral_1h_input_tokens ?? 0
  const write5mTokens = Math.max(0, (u.cache_creation_input_tokens ?? 0) - write1hTokens)
  const t = tokensOf(u)
  return {
    costs: {
      input: t.input * input,
      cacheRead: t.cacheRead * cacheRead,
      cacheWrite: write5mTokens * write5m + write1hTokens * write1h,
      output: t.output * rate.output_cost_per_token * mult,
    },
    cacheSavings: t.cacheRead * (input - cacheRead),
  }
}

function tokensOf(u) {
  return {
    input: u.input_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
    output: u.output_tokens ?? 0,
  }
}

const CATEGORIES = ['input', 'cacheRead', 'cacheWrite', 'output']
const sumOf = (o) => CATEGORIES.reduce((n, k) => n + o[k], 0)
const zeros = () => ({ input: 0, cacheRead: 0, cacheWrite: 0, output: 0 })
const addInto = (target, source) => {
  for (const k of CATEGORIES) target[k] += source[k]
}

const dayFormat = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

async function summarize({ root = claudeProjectsDir(), prices }) {
  let entries
  try {
    entries = await fsp.readdir(root, { recursive: true })
  } catch {
    return { root, days: {}, records: 0, unpriced: 0, files: 0, readAt: new Date().toISOString() }
  }
  const files = entries.filter((f) => f.endsWith('.jsonl'))
  // Streaming writes one line per content block; each repeats the message's usage,
  // and only the last line carries the final output_tokens. Keep the last per message.
  const byMessage = new Map()
  const unkeyed = []

  for (const file of files) {
    const lines = readline.createInterface({
      input: fs.createReadStream(path.join(root, file)),
      crlfDelay: Infinity,
    })
    for await (const line of lines) {
      if (!line.includes('"usage"')) continue
      let r
      try {
        r = JSON.parse(line)
      } catch {
        continue
      }
      const m = r.message
      if (r.type !== 'assistant' || !m?.usage || typeof m.model !== 'string' || !r.timestamp) {
        continue
      }
      if (m.id || r.requestId) byMessage.set(`${m.id ?? ''}:${r.requestId ?? ''}`, r)
      else unkeyed.push(r)
    }
  }

  const days = {}
  let unpriced = 0
  const all = [...byMessage.values(), ...unkeyed]
  for (const r of all) {
    const { model, usage } = r.message
    const tokens = tokensOf(usage)
    const rate = lookupRate(prices, model)
    let priced = rate ? priceUsage(rate, usage) : null
    if (typeof r.costUSD === 'number') {
      // A reported cost wins; split it in proportion to list rates when known.
      const list = priced ? sumOf(priced.costs) : 0
      const scale = list > 0 ? r.costUSD / list : 0
      priced = {
        costs: list > 0
          ? Object.fromEntries(CATEGORIES.map((k) => [k, priced.costs[k] * scale]))
          : { ...zeros(), output: r.costUSD },
        cacheSavings: priced ? priced.cacheSavings * scale : 0,
      }
    }
    if (priced === null) unpriced++

    const day = dayFormat.format(new Date(r.timestamp))
    const d = (days[day] ??= { tokens: zeros(), costs: zeros(), cacheSavings: 0, models: {} })
    const m = (d.models[model] ??= { tokens: 0, cost: 0 })
    addInto(d.tokens, tokens)
    m.tokens += sumOf(tokens)
    if (priced) {
      addInto(d.costs, priced.costs)
      d.cacheSavings += priced.cacheSavings
      m.cost += sumOf(priced.costs)
    }
  }
  return { root, days, records: all.length, unpriced, files: files.length, readAt: new Date().toISOString() }
}

module.exports = { summarize, fetchPrices, priceUsage, lookupRate, claudeProjectsDir }
