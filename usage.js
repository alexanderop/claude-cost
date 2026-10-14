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

function priceUsage(rate, u) {
  const mult = u.speed === 'fast' ? (rate.provider_specific_entry?.fast ?? 1) : 1
  const input = rate.input_cost_per_token
  const write5m = rate.cache_creation_input_token_cost ?? input
  // 1h cache writes bill at a higher rate than the default 5m ones.
  const write1hTokens = u.cache_creation?.ephemeral_1h_input_tokens ?? 0
  const write5mTokens = Math.max(0, (u.cache_creation_input_tokens ?? 0) - write1hTokens)
  return (
    mult *
    ((u.input_tokens ?? 0) * input +
      (u.cache_read_input_tokens ?? 0) * (rate.cache_read_input_token_cost ?? input) +
      write5mTokens * write5m +
      write1hTokens * (rate.cache_creation_input_token_cost_above_1hr ?? write5m) +
      (u.output_tokens ?? 0) * rate.output_cost_per_token)
  )
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
    return { root, days: {}, models: {}, total: 0, records: 0, unpriced: 0, files: 0 }
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
  const models = {}
  let total = 0
  let unpriced = 0
  const all = [...byMessage.values(), ...unkeyed]
  for (const r of all) {
    const { model, usage } = r.message
    const rate = lookupRate(prices, model)
    const cost = typeof r.costUSD === 'number' ? r.costUSD : rate ? priceUsage(rate, usage) : null
    if (cost === null) {
      unpriced++
      continue
    }
    const day = dayFormat.format(new Date(r.timestamp))
    days[day] = (days[day] ?? 0) + cost
    models[model] = (models[model] ?? 0) + cost
    total += cost
  }
  const records = all.length
  return { root, days, models, total, records, unpriced, files: files.length }
}

module.exports = { summarize, fetchPrices, priceUsage, lookupRate, claudeProjectsDir }
