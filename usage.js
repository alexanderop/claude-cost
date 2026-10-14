// Estimates API-equivalent cost from local agent transcripts, the way T3 Code does:
// Claude Code and Codex JSONL token counts × LiteLLM list prices.
// Not what a subscription bills.
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const readline = require('node:readline')

const PRICES_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'

// Bare family names are ambiguous across generations; <synthetic> was never billed.
const UNPRICEABLE = new Set(['<synthetic>', 'synthetic', 'opus', 'sonnet', 'haiku', 'fable'])

// A forked Codex rollout opens with the parent's history copied in one burst.
// Same threshold as T3 Code and ccusage.
const FORK_COPY_MAX_GAP_MS = 1000

const CATEGORIES = ['input', 'cacheRead', 'cacheWrite', 'output']
const sumOf = (o) => CATEGORIES.reduce((n, k) => n + o[k], 0)
const zeros = () => ({ input: 0, cacheRead: 0, cacheWrite: 0, output: 0 })
const addInto = (target, source) => {
  for (const k of CATEGORIES) target[k] += source[k]
}
const count = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.trunc(v) : 0)

function homeDir(envVar, fallback) {
  return process.env[envVar]?.trim() || path.join(os.homedir(), fallback)
}

async function fetchPrices() {
  const res = await fetch(PRICES_URL)
  if (!res.ok) throw new Error(`LiteLLM prices: HTTP ${res.status}`)
  return res.json()
}

async function jsonlFiles(root) {
  try {
    const entries = await fsp.readdir(root, { recursive: true })
    return entries.filter((f) => f.endsWith('.jsonl')).map((f) => path.join(root, f))
  } catch {
    return []
  }
}

function lines(file) {
  return readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity })
}

function parseJson(line) {
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}

// ── Claude Code: ~/.claude/projects/**/*.jsonl ────────────────────────────────

async function readClaude(root) {
  const files = await jsonlFiles(root)
  // Streaming writes one line per content block; each repeats the message's usage,
  // and only the last line carries the final output_tokens. Keep the last per message.
  const byMessage = new Map()
  const unkeyed = []
  for (const file of files) {
    for await (const line of lines(file)) {
      if (!line.includes('"usage"')) continue
      const r = parseJson(line)
      const m = r?.message
      const u = m?.usage
      if (r?.type !== 'assistant' || !u || typeof m.model !== 'string' || !r.timestamp) continue
      const record = {
        provider: 'claude',
        model: m.model,
        timestamp: r.timestamp,
        tokens: {
          input: count(u.input_tokens),
          cacheRead: count(u.cache_read_input_tokens),
          cacheWrite: count(u.cache_creation_input_tokens),
          output: count(u.output_tokens),
        },
        write1h: count(u.cache_creation?.ephemeral_1h_input_tokens),
        speed: u.speed === 'fast' ? 'fast' : 'standard',
        promptTokens:
          count(u.input_tokens) + count(u.cache_read_input_tokens) + count(u.cache_creation_input_tokens),
        reportedCost: typeof r.costUSD === 'number' ? r.costUSD : null,
      }
      if (m.id || r.requestId) byMessage.set(`${m.id ?? ''}:${r.requestId ?? ''}`, record)
      else unkeyed.push(record)
    }
  }
  return { files: files.length, records: [...byMessage.values(), ...unkeyed] }
}

// ── Codex: ~/.codex/sessions/**/*.jsonl ───────────────────────────────────────

const CODEX_MARKERS = ['"token_count"', '"turn_context"', '"thread_settings_applied"', '"session_meta"']

function codexSpeed(tier) {
  if (tier === 'priority' || tier === 'fast') return 'fast'
  if (tier === 'ultrafast') return 'ultrafast'
  return 'standard'
}

function isForkedSessionMeta(payload) {
  return (
    typeof payload.forked_from_id === 'string' ||
    typeof payload.source?.subagent?.thread_spawn?.parent_thread_id === 'string'
  )
}

async function readCodex(root) {
  const files = await jsonlFiles(root)
  // A rollout that moved leaves a copy behind; key events so each counts once.
  const byEvent = new Map()
  for (const file of files) {
    // token_count events carry no model or tier, so both carry forward from
    // the latest turn_context / thread_settings_applied line.
    const state = {
      model: '',
      speed: 'standard',
      sessionId: '',
      lastSignature: null,
      sawMeta: false,
      suppressingForkCopies: false,
      forkAnchorMs: 0,
    }
    for await (const line of lines(file)) {
      if (!CODEX_MARKERS.some((marker) => line.includes(marker))) continue
      const r = parseJson(line)
      const p = r?.payload
      if (typeof p !== 'object' || p === null) continue

      if (r.type === 'session_meta') {
        // Only the first meta is this file's own; forks repeat their ancestors'.
        if (state.sawMeta) continue
        state.sawMeta = true
        state.sessionId = p.id ?? p.session_id ?? ''
        const ms = Date.parse(r.timestamp)
        if (!Number.isNaN(ms) && isForkedSessionMeta(p)) {
          state.suppressingForkCopies = true
          state.forkAnchorMs = ms
        }
        continue
      }
      if (r.type === 'turn_context') {
        if (typeof p.model === 'string') state.model = p.model
        continue
      }
      if (p.type === 'thread_settings_applied') {
        state.speed = codexSpeed(p.thread_settings?.service_tier)
        continue
      }
      if (p.type !== 'token_count') continue

      const last = p.info?.last_token_usage
      const ms = Date.parse(r.timestamp)
      if (!last || Number.isNaN(ms) || state.model === '') continue

      // Codex re-emits an unchanged token_count on some stream boundaries.
      const signature = JSON.stringify(last)
      if (signature === state.lastSignature) continue
      state.lastSignature = signature

      // The parent's copied history was already counted from the parent's file.
      if (state.suppressingForkCopies) {
        if (ms - state.forkAnchorMs < FORK_COPY_MAX_GAP_MS) {
          state.forkAnchorMs = ms
          continue
        }
        state.suppressingForkCopies = false
      }

      const input = count(last.input_tokens)
      const cacheRead = count(last.cached_input_tokens)
      const cacheWrite = count(last.cache_write_input_tokens)
      const output = count(last.output_tokens)
      // Codex reports input_tokens inclusive of the cached portion.
      const tokens = { input: Math.max(0, input - cacheRead - cacheWrite), cacheRead, cacheWrite, output }
      if (sumOf(tokens) === 0) continue

      byEvent.set(`${state.sessionId}:${r.timestamp}:${signature}`, {
        provider: 'codex',
        model: state.model,
        timestamp: r.timestamp,
        tokens,
        write1h: 0,
        speed: state.speed,
        promptTokens: input,
        reportedCost: null,
      })
    }
  }
  return { files: files.length, records: [...byEvent.values()] }
}

// ── Pricing ───────────────────────────────────────────────────────────────────

const SPEED_SUFFIX = { standard: '', fast: '_priority', ultrafast: '_ultrafast' }

/**
 * Where Claude requests are priced. Bedrock rates live in LiteLLM under
 * prefixed keys; regional endpoints cost ~10% more than global.
 */
const PRICING_PROFILES = {
  anthropic: { label: 'Anthropic API', key: (m) => m },
  'bedrock-global': { label: 'Bedrock global', key: (m) => `global.anthropic.${m}` },
  'bedrock-eu': { label: 'Bedrock EU', key: (m) => `eu.anthropic.${m}` },
  'bedrock-us': { label: 'Bedrock US', key: (m) => `us.anthropic.${m}` },
}

function validEntry(p) {
  return typeof p?.input_cost_per_token === 'number' && typeof p?.output_cost_per_token === 'number'
}

/**
 * The rate entry for a model under a pricing profile. Falls back to the plain
 * entry when the profile has no price for the model, and says so. Fast mode is
 * a multiple only the plain Anthropic entry publishes, so it is carried over.
 */
function lookupRate(prices, model, profile = 'anthropic') {
  const base = model.trim().toLowerCase().split('[')[0]
  if (UNPRICEABLE.has(base)) return null
  const plain = prices[base]
  if (!validEntry(plain)) return null
  const profiled = prices[PRICING_PROFILES[profile].key(base)]
  const usable = validEntry(profiled)
  return {
    entry: usable ? profiled : plain,
    fellBack: profile !== 'anthropic' && !usable,
    fastMultiplier: plain.provider_specific_entry?.fast,
  }
}

/** The long-context tier a prompt falls in, read from `*_above_<n>k_tokens` field names. */
function longContextSuffix(entry, promptTokens) {
  let best = ''
  let bestThreshold = 0
  for (const name of Object.keys(entry)) {
    const match = /^input_cost_per_token_above_(\d+)k_tokens$/.exec(name)
    const threshold = match ? Number(match[1]) * 1000 : 0
    if (threshold && promptTokens > threshold && threshold > bestThreshold) {
      best = `_above_${match[1]}k_tokens`
      bestThreshold = threshold
    }
  }
  return best
}

/**
 * Per-token rates for one request. Speed and long-context tiers are suffixed
 * LiteLLM fields (`_priority`, `_ultrafast`, `_above_272k_tokens`); a tier the
 * table lacks falls back to the next simpler one. Claude fast mode is a plain
 * multiple instead.
 */
function ratesFor({ entry, fastMultiplier }, { speed, promptTokens }) {
  const claudeFast = speed === 'fast' ? fastMultiplier : undefined
  const s = claudeFast ? '' : SPEED_SUFFIX[speed]
  const long = longContextSuffix(entry, promptTokens)
  const suffixes = [...new Set([long + s, s, long, ''])]
  const pick = (field) => {
    for (const suffix of suffixes) {
      const v = entry[field + suffix]
      if (typeof v === 'number') return v * (claudeFast ?? 1)
    }
    return undefined
  }
  const input = pick('input_cost_per_token')
  const cacheWrite = pick('cache_creation_input_token_cost') ?? input
  return {
    input,
    output: pick('output_cost_per_token'),
    cacheRead: pick('cache_read_input_token_cost') ?? input,
    cacheWrite,
    // 1h cache writes bill at a higher rate than the default 5m ones.
    cacheWrite1h: pick('cache_creation_input_token_cost_above_1hr') ?? cacheWrite,
  }
}

function priceRecord(prices, record, profile = 'anthropic') {
  const rate = lookupRate(prices, record.model, record.provider === 'claude' ? profile : 'anthropic')
  if (!rate) {
    if (record.reportedCost === null) return null
    return { costs: { ...zeros(), output: record.reportedCost }, cacheSavings: 0, fellBack: false }
  }
  const r = ratesFor(rate, record)
  const t = record.tokens
  const write1h = Math.min(record.write1h, t.cacheWrite)
  const costs = {
    input: t.input * r.input,
    cacheRead: t.cacheRead * r.cacheRead,
    cacheWrite: (t.cacheWrite - write1h) * r.cacheWrite + write1h * r.cacheWrite1h,
    output: t.output * r.output,
  }
  const cacheSavings = t.cacheRead * (r.input - r.cacheRead)
  // A reported cost is what Anthropic's API charged; it doesn't apply elsewhere.
  if (record.reportedCost !== null && profile === 'anthropic') {
    const list = sumOf(costs)
    if (list <= 0) return { costs: { ...zeros(), output: record.reportedCost }, cacheSavings: 0, fellBack: false }
    const scale = record.reportedCost / list
    for (const k of CATEGORIES) costs[k] *= scale
    return { costs, cacheSavings: cacheSavings * scale, fellBack: false }
  }
  return { costs, cacheSavings, fellBack: rate.fellBack }
}

// ── Aggregation ───────────────────────────────────────────────────────────────

const dayFormat = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const SOURCES = {
  claude: { root: () => path.join(homeDir('CLAUDE_CONFIG_DIR', '.claude'), 'projects'), read: readClaude },
  codex: { root: () => path.join(homeDir('CODEX_HOME', '.codex'), 'sessions'), read: readCodex },
}

/** Reads every source. Slow (seconds); the result can be re-priced cheaply. */
async function scan() {
  const sources = {}
  for (const [provider, source] of Object.entries(SOURCES)) {
    const root = source.root()
    sources[provider] = { root, ...(await source.read(root)) }
  }
  return sources
}

/**
 * Prices scanned records under a pricing profile. `days[day][provider]` holds
 * token and cost totals by category plus per-model figures, so the UI can
 * filter by provider and period without re-pricing. `baselineCost` is the same
 * Claude usage at Anthropic API prices, for comparison.
 */
function aggregate(sources, prices, profile = 'anthropic') {
  const days = {}
  const providers = {}
  const fellBackModels = new Set()
  for (const [provider, { root, files, records }] of Object.entries(sources)) {
    const stats = (providers[provider] = { root, files, records: records.length, unpriced: 0, cost: 0, baselineCost: 0 })
    for (const record of records) {
      const priced = priceRecord(prices, record, profile)
      if (priced === null) stats.unpriced++
      if (priced?.fellBack) fellBackModels.add(record.model)
      const day = dayFormat.format(new Date(record.timestamp))
      const d = ((days[day] ??= {})[provider] ??= { tokens: zeros(), costs: zeros(), baselineCost: 0, cacheSavings: 0, models: {} })
      const m = (d.models[record.model] ??= { tokens: 0, cost: 0 })
      addInto(d.tokens, record.tokens)
      m.tokens += sumOf(record.tokens)
      if (priced) {
        addInto(d.costs, priced.costs)
        d.cacheSavings += priced.cacheSavings
        m.cost += sumOf(priced.costs)
        const baseline = profile === 'anthropic' ? priced : priceRecord(prices, record)
        d.baselineCost += sumOf(baseline.costs)
        stats.cost += sumOf(priced.costs)
        stats.baselineCost += sumOf(baseline.costs)
      }
    }
  }
  return {
    days,
    providers,
    profile,
    profiles: Object.fromEntries(Object.entries(PRICING_PROFILES).map(([k, v]) => [k, v.label])),
    fellBackModels: [...fellBackModels].sort(),
    readAt: new Date().toISOString(),
  }
}

async function summarize({ prices, profile }) {
  return aggregate(await scan(), prices, profile)
}

module.exports = { scan, aggregate, summarize, fetchPrices, lookupRate, ratesFor, priceRecord, PRICING_PROFILES }
