const CATEGORIES = [
  { key: 'input', label: 'Input', color: '#6a9bcc' },
  { key: 'cacheRead', label: 'Cache read', color: '#5fb3a8' },
  { key: 'cacheWrite', label: 'Cache write', color: '#c9a35c' },
  { key: 'output', label: 'Output', color: '#d97757' },
]
const FAMILY_COLORS = [
  ['fable', '#b07cc6'],
  ['opus', '#d97757'],
  ['sonnet', '#6a9bcc'],
  ['haiku', '#788c5d'],
]
const EXTRA_COLORS = ['#c9a35c', '#5fb3a8', '#c46b8a']
const OTHER_COLOR = '#77777c'
const MAX_SERIES = 5

const usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const usdCompact = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 })
const tokenFmt = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
const dayLabel = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const dayKey = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' })

const usd = (n) => usdFmt.format(n)
const usdShort = (n) => (n >= 1000 ? usdCompact.format(n) : usdFmt.format(n).replace(/\.00$/, ''))
const tokens = (n) => tokenFmt.format(n)
const pct = (n) => `${(n * 100).toFixed(n >= 0.1 ? 0 : 1)}%`
const sum = (o) => o.input + o.cacheRead + o.cacheWrite + o.output
const $ = (id) => document.getElementById(id)

const state = { summary: null, period: '30', metric: 'cost' }

function parseDay(key) {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d, 12)
}

/** Every calendar day in the window, oldest first, including days with no usage. */
function windowDays(days, period) {
  const today = new Date()
  today.setHours(12, 0, 0, 0)
  const keys = Object.keys(days).sort()
  const start = new Date(today)
  if (period === 'all') {
    if (keys.length === 0) return [dayKey.format(today)]
    start.setTime(parseDay(keys[0]).getTime())
  } else {
    start.setDate(start.getDate() - (Number(period) - 1))
  }
  const out = []
  for (const d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) out.push(dayKey.format(d))
  return out
}

function colorFor(model, used) {
  const lower = model.toLowerCase()
  const family = FAMILY_COLORS.find(([name, color]) => lower.includes(name) && !used.has(color))
  const color = family?.[1] ?? EXTRA_COLORS.find((c) => !used.has(c)) ?? OTHER_COLOR
  used.add(color)
  return color
}

function aggregate(periods) {
  const totals = { tokens: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }, costs: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }, cacheSavings: 0, activeDays: 0 }
  const models = new Map()
  for (const p of periods) {
    const day = state.summary.days[p]
    if (!day) continue
    totals.activeDays++
    for (const c of CATEGORIES) {
      totals.tokens[c.key] += day.tokens[c.key]
      totals.costs[c.key] += day.costs[c.key]
    }
    totals.cacheSavings += day.cacheSavings
    for (const [name, m] of Object.entries(day.models)) {
      if (m.tokens === 0 && m.cost === 0) continue
      const acc = models.get(name) ?? { name, tokens: 0, cost: 0 }
      acc.tokens += m.tokens
      acc.cost += m.cost
      models.set(name, acc)
    }
  }
  const ranked = [...models.values()].sort((a, b) => b.cost - a.cost || b.tokens - a.tokens)
  const used = new Set()
  for (const m of ranked) m.color = colorFor(m.name, used)
  return { totals, models: ranked }
}

function tile(label, value, sub) {
  const div = document.createElement('div')
  div.className = 'tile'
  div.innerHTML = '<div class="label"></div><div class="value"></div><div class="sub"></div>'
  div.querySelector('.label').textContent = label
  div.querySelector('.value').textContent = value
  div.querySelector('.sub').textContent = sub ?? ''
  return div
}

function renderTiles({ totals }, periods) {
  const cost = sum(totals.costs)
  const allTokens = sum(totals.tokens)
  const inputSide = totals.tokens.input + totals.tokens.cacheRead + totals.tokens.cacheWrite
  $('tiles').replaceChildren(
    tile('Cost', usd(cost), `${usd(cost / periods.length)} / day avg`),
    tile('Processed tokens', tokens(allTokens), `${totals.activeDays} active days`),
    tile('Output tokens', tokens(totals.tokens.output), `${usd(totals.costs.output)} of cost`),
    tile('Cache hit rate', inputSide ? pct(totals.tokens.cacheRead / inputSide) : '—', 'of input read from cache'),
    tile('Cache savings', usd(totals.cacheSavings), 'vs. uncached input'),
  )
}

function shareBar(container, title, values, format) {
  const total = sum(values)
  container.replaceChildren()
  const wrap = document.createElement('div')
  wrap.className = 'share'
  const head = document.createElement('div')
  head.className = 'card-head'
  head.style.marginBottom = '0'
  const h2 = document.createElement('h2')
  h2.textContent = title
  const totalEl = document.createElement('span')
  totalEl.className = 'muted'
  totalEl.textContent = format(total)
  head.append(h2, totalEl)

  const bar = document.createElement('div')
  bar.className = 'bar'
  const legend = document.createElement('div')
  legend.className = 'legend'
  for (const c of CATEGORIES) {
    const v = values[c.key]
    if (v <= 0) continue
    const seg = document.createElement('div')
    seg.style.flex = `${v} 1 0`
    seg.style.background = c.color
    seg.title = `${c.label} · ${format(v)} · ${pct(v / total)}`
    bar.append(seg)

    const item = document.createElement('span')
    item.innerHTML = '<i class="swatch"></i><span></span><b></b>'
    item.querySelector('.swatch').style.background = c.color
    item.querySelector('span').textContent = c.label
    item.querySelector('b').textContent = format(v)
    legend.append(item)
  }
  wrap.append(head, bar, legend)
  container.append(wrap)
}

function renderChart({ models }, periods) {
  const key = state.metric === 'cost' ? 'cost' : 'tokens'
  const top = models.slice(0, MAX_SERIES)
  const rest = models.slice(MAX_SERIES)
  const valuesFor = (names) =>
    periods.map((p) => {
      const day = state.summary.days[p]
      return names.reduce((n, name) => n + (day?.models[name]?.[key] ?? 0), 0)
    })
  const series = top.map((m) => ({ key: m.name, label: m.name, color: m.color, values: valuesFor([m.name]) }))
  if (rest.length) series.push({ key: 'other', label: 'Other', color: OTHER_COLOR, values: valuesFor(rest.map((m) => m.name)) })

  $('chart-title').textContent = state.metric === 'cost' ? 'Daily cost by model' : 'Daily tokens by model'
  $('chart-svg').setAttribute('aria-label', $('chart-title').textContent)
  $('chart-legend').replaceChildren(
    ...series.map((s) => {
      const item = document.createElement('span')
      item.innerHTML = '<i class="swatch"></i><span></span>'
      item.querySelector('.swatch').style.background = s.color
      item.querySelector('span').textContent = s.label
      return item
    }),
  )
  window.UsageChart.render({
    periods,
    series,
    format: state.metric === 'cost' ? usdShort : tokens,
    formatPeriod: (p) => dayLabel.format(parseDay(p)),
    nodes: {
      svg: $('chart-svg'), plot: $('plot'), yAxis: $('y-axis'), xAxis: $('x-axis'),
      crosshair: $('crosshair'), tooltip: $('tooltip'),
    },
  })
}

function renderModels({ models }) {
  const maxCost = Math.max(...models.map((m) => m.cost), 0)
  const head = document.createElement('tr')
  head.innerHTML = '<th>Model</th><th class="num">Tokens</th><th class="num">Cost</th><th></th>'
  $('models').replaceChildren(
    head,
    ...models.map((m) => {
      const tr = document.createElement('tr')
      tr.innerHTML = '<td><div class="name"><i class="swatch"></i><span></span></div></td><td class="num"></td><td class="num"></td><td class="meter-cell"><div class="meter"><div></div></div></td>'
      tr.querySelector('.swatch').style.background = m.color
      tr.querySelector('.name span').textContent = m.name
      tr.children[1].textContent = tokens(m.tokens)
      tr.children[2].textContent = m.cost > 0 ? usd(m.cost) : 'unpriced'
      const fill = tr.querySelector('.meter div')
      fill.style.width = maxCost > 0 ? `${(m.cost / maxCost) * 100}%` : '0'
      fill.style.background = m.color
      return tr
    }),
  )
}

function render() {
  if (!state.summary) return
  const periods = windowDays(state.summary.days, state.period)
  const agg = aggregate(periods)
  renderTiles(agg, periods)
  renderChart(agg, periods)
  shareBar($('share-cost'), 'Cost by type', agg.totals.costs, usd)
  shareBar($('share-tokens'), 'Tokens by type', agg.totals.tokens, tokens)
  renderModels(agg)
}

async function load() {
  const meta = $('meta')
  const refresh = $('refresh')
  refresh.classList.add('spinning')
  meta.className = 'muted'
  try {
    state.summary = await window.usage.summary()
    const s = state.summary
    meta.textContent = `${s.records.toLocaleString()} responses · ${s.files} transcripts · ${s.unpriced} unpriced · updated ${new Date(s.readAt).toLocaleTimeString()}`
    render()
  } catch (err) {
    meta.className = 'muted error'
    meta.textContent = String(err)
  } finally {
    refresh.classList.remove('spinning')
  }
}

function segmented(id, key) {
  $(id).addEventListener('click', (event) => {
    const button = event.target.closest('button')
    if (!button) return
    for (const b of $(id).querySelectorAll('button')) b.setAttribute('aria-pressed', String(b === button))
    state[key] = button.dataset.value
    render()
  })
}

segmented('period', 'period')
segmented('metric', 'metric')
$('refresh').addEventListener('click', load)
load()
