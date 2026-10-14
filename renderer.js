const CATEGORIES = [
  { key: 'input', label: 'Input', color: '#6a9bcc' },
  { key: 'cacheRead', label: 'Cache read', color: '#5fb3a8' },
  { key: 'cacheWrite', label: 'Cache write', color: '#c9a35c' },
  { key: 'output', label: 'Output', color: '#d97757' },
]
const PROVIDERS = [
  { key: 'claude', label: 'Claude Code', color: '#d97757' },
  { key: 'codex', label: 'Codex', color: '#10a37f' },
]
const FAMILY_COLORS = [
  ['fable', '#b07cc6'],
  ['opus', '#d97757'],
  ['sonnet', '#6a9bcc'],
  ['haiku', '#788c5d'],
  ['sol', '#10a37f'],
  ['astra', '#9b87f5'],
  ['luna', '#e0b84f'],
]
const EXTRA_COLORS = ['#5fb3a8', '#c46b8a', '#c9a35c', '#8fa8d8', '#a3c46b']
const OTHER_COLOR = '#77777c'
const MAX_SERIES = 5
const MAX_PROJECTS = 15
const MAX_SESSIONS = 10
const HOUR_WINDOW = 48
const MULTI_COLOR = '#8fa8d8'
const HEAT_COLOR = '217 119 87'
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const PLANS_KEY = 'claude-cost:plans'
const DAYS_PER_MONTH = 30.44

const usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const usdCompact = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 })
const tokenFmt = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
const dayLabel = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const dayKey = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' })
const weekdayLabel = new Intl.DateTimeFormat(undefined, { weekday: 'short' })
const monthLabel = new Intl.DateTimeFormat(undefined, { month: 'short', year: '2-digit' })
const dateTimeLabel = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const timeLabel = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

const usd = (n) => usdFmt.format(n)
const usdShort = (n) => (n >= 1000 ? usdCompact.format(n) : usdFmt.format(n).replace(/\.00$/, ''))
const tokens = (n) => tokenFmt.format(n)
const pct = (n) => `${(n * 100).toFixed(n >= 0.1 ? 0 : 1)}%`
const sum = (o) => o.input + o.cacheRead + o.cacheWrite + o.output
const $ = (id) => document.getElementById(id)

const positive = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0)

const state = { summary: null, period: '30', metric: 'cost', provider: 'all', profile: 'anthropic', resolution: 'day', plans: loadPlans() }

function loadPlans() {
  try {
    const stored = JSON.parse(localStorage.getItem(PLANS_KEY))
    return { claude: positive(stored?.claude), codex: positive(stored?.codex) }
  } catch {
    return { claude: 0, codex: 0 }
  }
}

const selectedProviders = () =>
  state.provider === 'all' ? PROVIDERS.map((p) => p.key) : [state.provider]

/** The selected providers' entries for one day or hour bucket. */
const entriesIn = (buckets, key) =>
  selectedProviders().map((p) => buckets[key]?.[p]).filter(Boolean)
const dayEntries = (day) => entriesIn(state.summary.days, day)

const isCost = () => state.metric === 'cost'
const fmtMetric = (n) => (isCost() ? usd(n) : tokens(n))
/** What the Cost/Tokens toggle measures, for a day entry, an hour entry, or a project/session figure. */
const dayValue = (entry) => (isCost() ? sum(entry.costs) : sum(entry.tokens))
const flatValue = (entry) => (isCost() ? entry.cost : entry.tokens)

const baseName = (path) => path.split(/[\\/]/).filter(Boolean).pop() ?? path
const sourceLabel = (keys) =>
  PROVIDERS.filter((p) => keys.has(p.key)).map((p) => p.label).join(' + ')

function parseDay(key) {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d, 12)
}

/** Every calendar day in the window, oldest first, including days with no usage. */
function windowDays(days, period) {
  const today = new Date()
  today.setHours(12, 0, 0, 0)
  const keys = Object.keys(days).filter((k) => dayEntries(k).length).sort()
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

const hourKeyOf = (date) => `${dayKey.format(date)}T${String(date.getHours()).padStart(2, '0')}`

/** The last HOUR_WINDOW local hours, oldest first, including hours with no usage. */
function windowHours() {
  const now = new Date()
  now.setMinutes(0, 0, 0)
  return Array.from({ length: HOUR_WINDOW }, (_, i) =>
    hourKeyOf(new Date(now.getTime() - (HOUR_WINDOW - 1 - i) * 3_600_000)),
  )
}

const formatHour = (key) => {
  const [day, hour] = key.split('T')
  return `${weekdayLabel.format(parseDay(day))} ${hour}:00`
}

function colorFor(model, used) {
  const lower = model.toLowerCase()
  const family = FAMILY_COLORS.find(([name, color]) => lower.includes(name) && !used.has(color))
  const color = family?.[1] ?? EXTRA_COLORS.find((c) => !used.has(c)) ?? OTHER_COLOR
  used.add(color)
  return color
}

function aggregate(periods) {
  const totals = { tokens: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }, costs: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }, baselineCost: 0, cacheSavings: 0, activeDays: 0 }
  const byProvider = Object.fromEntries(PROVIDERS.map((p) => [p.key, 0]))
  const models = new Map()
  for (const p of periods) {
    const entries = selectedProviders().map((key) => [key, state.summary.days[p]?.[key]]).filter(([, e]) => e)
    if (entries.length) totals.activeDays++
    for (const [provider, day] of entries) {
      for (const c of CATEGORIES) {
        totals.tokens[c.key] += day.tokens[c.key]
        totals.costs[c.key] += day.costs[c.key]
      }
      totals.cacheSavings += day.cacheSavings
      totals.baselineCost += day.baselineCost
      byProvider[provider] += sum(day.costs)
      for (const [name, m] of Object.entries(day.models)) {
        if (m.tokens === 0 && m.cost === 0) continue
        const acc = models.get(name) ?? { name, provider, tokens: 0, cost: 0 }
        acc.tokens += m.tokens
        acc.cost += m.cost
        models.set(name, acc)
      }
    }
  }
  const ranked = [...models.values()].sort((a, b) => b.cost - a.cost || b.tokens - a.tokens)
  const used = new Set()
  for (const m of ranked) m.color = colorFor(m.name, used)
  return { totals, byProvider, models: ranked }
}

function tile(label, value, sub, action) {
  const div = document.createElement('div')
  div.className = 'tile'
  div.innerHTML = '<div class="label"></div><div class="value"></div><div class="sub"></div>'
  div.querySelector('.label').textContent = label
  div.querySelector('.value').textContent = value
  div.querySelector('.sub').textContent = sub ?? ''
  if (action) {
    const button = document.createElement('button')
    button.className = 'link'
    button.textContent = action.label
    button.addEventListener('click', action.onClick)
    div.append(button)
  }
  return div
}

function renderTiles({ totals }, periods) {
  const cost = sum(totals.costs)
  const allTokens = sum(totals.tokens)
  const inputSide = totals.tokens.input + totals.tokens.cacheRead + totals.tokens.cacheWrite
  const delta = cost - totals.baselineCost
  const costTile = tile('Cost', usd(cost), `${usd(cost / periods.length)} / day avg`)
  if (state.profile !== 'anthropic' && Math.abs(delta) >= 0.005) {
    const sub = costTile.querySelector('.sub')
    sub.textContent = `${delta > 0 ? '+' : '−'}${usd(Math.abs(delta))} vs Anthropic API`
    sub.className = 'sub delta-up'
  }
  $('tiles').replaceChildren(
    costTile,
    tile('Processed tokens', tokens(allTokens), `${totals.activeDays} active days`),
    tile('Output tokens', tokens(totals.tokens.output), `${usd(totals.costs.output)} of cost`),
    tile('Cache hit rate', inputSide ? pct(totals.tokens.cacheRead / inputSide) : '—', 'of input read from cache'),
    tile('Cache savings', usd(totals.cacheSavings), 'vs. uncached input'),
  )
}

const categorySegments = (values) => CATEGORIES.map((c) => ({ ...c, value: values[c.key] }))

function shareBar(container, title, segments, format) {
  container.hidden = false
  const total = segments.reduce((n, seg) => n + seg.value, 0)
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
  for (const c of segments) {
    const v = c.value
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
  const key = isCost() ? 'cost' : 'tokens'
  const hourly = state.resolution === 'hour'
  const keys = hourly ? windowHours() : periods
  const buckets = hourly ? state.summary.hours : state.summary.days
  const valuesFor = (names) =>
    keys.map((k) =>
      entriesIn(buckets, k).reduce(
        (n, entry) => n + names.reduce((m, name) => m + (entry.models[name]?.[key] ?? 0), 0),
        0,
      ),
    )
  // The hourly window only shows models that were active in it.
  const ranked = hourly
    ? models
        .map((m) => ({ m, total: valuesFor([m.name]).reduce((a, b) => a + b, 0) }))
        .filter((r) => r.total > 0)
        .sort((a, b) => b.total - a.total)
        .map((r) => r.m)
    : models
  const top = ranked.slice(0, MAX_SERIES)
  const rest = ranked.slice(MAX_SERIES)
  const series = top.map((m) => ({ key: m.name, label: m.name, color: m.color, values: valuesFor([m.name]) }))
  if (rest.length) series.push({ key: 'other', label: 'Other', color: OTHER_COLOR, values: valuesFor(rest.map((m) => m.name)) })

  $('chart-title').textContent = `${hourly ? `Hourly ${isCost() ? 'cost' : 'tokens'} by model · last ${HOUR_WINDOW} h` : `Daily ${isCost() ? 'cost' : 'tokens'} by model`}`
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
    periods: keys,
    series,
    format: isCost() ? usdShort : tokens,
    formatPeriod: hourly ? formatHour : (p) => dayLabel.format(parseDay(p)),
    nodes: {
      svg: $('chart-svg'), plot: $('plot'), yAxis: $('y-axis'), xAxis: $('x-axis'),
      crosshair: $('crosshair'), tooltip: $('tooltip'),
    },
  })
}

/** Name / source / tokens / cost / share-meter table, shared by models and projects. */
function breakdownTable(table, firstHeader, rows) {
  const maxCost = Math.max(...rows.map((r) => r.cost), 0)
  const head = document.createElement('tr')
  head.innerHTML = '<th></th><th>Source</th><th class="num">Tokens</th><th class="num">Cost</th><th></th>'
  head.children[0].textContent = firstHeader
  table.replaceChildren(
    head,
    ...rows.map((r) => {
      const tr = document.createElement('tr')
      tr.innerHTML = '<td><div class="name"><i class="swatch"></i><span></span></div></td><td class="muted-cell"></td><td class="num"></td><td class="num"></td><td class="meter-cell"><div class="meter"><div></div></div></td>'
      tr.querySelector('.swatch').style.background = r.color
      tr.querySelector('.name span').textContent = r.name
      tr.querySelector('.name span').title = r.title ?? r.name
      tr.children[1].textContent = r.source
      tr.children[2].textContent = tokens(r.tokens)
      tr.children[3].textContent = r.cost > 0 ? usd(r.cost) : 'unpriced'
      const fill = tr.querySelector('.meter div')
      fill.style.width = maxCost > 0 ? `${(r.cost / maxCost) * 100}%` : '0'
      fill.style.background = r.color
      return tr
    }),
  )
}

function renderModels({ models }) {
  breakdownTable($('models'), 'Model', models.map((m) => ({
    name: m.name,
    color: m.color,
    source: PROVIDERS.find((p) => p.key === m.provider)?.label ?? m.provider,
    tokens: m.tokens,
    cost: m.cost,
  })))
}

function renderProjects(periods) {
  const byPath = new Map()
  for (const p of periods) {
    for (const key of selectedProviders()) {
      const day = state.summary.days[p]?.[key]
      for (const [path, v] of Object.entries(day?.projects ?? {})) {
        if (v.tokens === 0 && v.cost === 0) continue
        const acc = byPath.get(path) ?? { path, providers: new Set(), tokens: 0, cost: 0 }
        acc.providers.add(key)
        acc.tokens += v.tokens
        acc.cost += v.cost
        byPath.set(path, acc)
      }
    }
  }
  const ranked = [...byPath.values()].sort((a, b) => b.cost - a.cost || b.tokens - a.tokens)
  const rows = ranked.slice(0, MAX_PROJECTS).map((r) => ({
    name: r.path ? baseName(r.path) : '(unknown)',
    title: r.path || 'No working directory recorded',
    color: r.providers.size === 1 ? PROVIDERS.find((p) => r.providers.has(p.key)).color : MULTI_COLOR,
    source: sourceLabel(r.providers),
    tokens: r.tokens,
    cost: r.cost,
  }))
  const rest = ranked.slice(MAX_PROJECTS)
  if (rest.length) {
    rows.push({
      name: 'Other',
      title: `${rest.length} more projects`,
      color: OTHER_COLOR,
      source: sourceLabel(new Set(rest.flatMap((r) => [...r.providers]))),
      tokens: rest.reduce((n, r) => n + r.tokens, 0),
      cost: rest.reduce((n, r) => n + r.cost, 0),
    })
  }
  breakdownTable($('projects'), 'Project', rows)
}

function formatDuration(ms) {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 1) return 'under 1 min'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

function sessionWhen(first, last) {
  const start = new Date(first)
  const end = new Date(last)
  const sameDay = dayKey.format(start) === dayKey.format(end)
  const range = sameDay
    ? `${dateTimeLabel.format(start)}–${timeLabel.format(end)}`
    : `${dateTimeLabel.format(start)} → ${dateTimeLabel.format(end)}`
  return { range, duration: formatDuration(end - start) }
}

function renderSessions(periods) {
  const inPeriod = new Set(periods)
  const providers = new Set(selectedProviders())
  const top = state.summary.sessions
    .filter((s) => providers.has(s.provider) && inPeriod.has(dayKey.format(new Date(s.last))))
    .sort((a, b) => b.cost - a.cost || b.tokens - a.tokens)
    .slice(0, MAX_SESSIONS)

  const head = document.createElement('tr')
  head.innerHTML = '<th>When</th><th>Project</th><th>Model(s)</th><th class="num">Responses</th><th class="num">Cost</th>'
  $('sessions').replaceChildren(
    head,
    ...top.map((s) => {
      const tr = document.createElement('tr')
      tr.innerHTML = '<td><div></div><div class="sub-line"></div></td><td><div class="name"><i class="swatch"></i><span></span></div></td><td class="muted-cell truncate"></td><td class="num"></td><td class="num"></td>'
      const when = sessionWhen(s.first, s.last)
      tr.querySelector('td div').textContent = when.range
      tr.querySelector('.sub-line').textContent = when.duration
      tr.querySelector('.swatch').style.background = PROVIDERS.find((p) => p.key === s.provider)?.color ?? OTHER_COLOR
      const project = tr.querySelector('.name span')
      project.textContent = s.project ? baseName(s.project) : '(unknown)'
      project.title = s.project || 'No working directory recorded'
      const models = s.models.filter((m) => !m.startsWith('<'))
      const modelCell = tr.children[2]
      modelCell.textContent = models.length > 2 ? `${models.slice(0, 2).join(', ')} +${models.length - 2}` : models.join(', ')
      modelCell.title = models.join(', ')
      tr.children[3].textContent = s.responses.toLocaleString()
      tr.children[4].textContent = s.cost > 0 ? usd(s.cost) : 'unpriced'
      tr.children[4].title = `${tokens(s.tokens)} tokens · session ${s.id}`
      return tr
    }),
  )
}

/** Cell background for a heatmap: empty is flat grey, the rest ramps in opacity. */
const heat = (value, max) =>
  value > 0 ? `rgb(${HEAT_COLOR} / ${(0.18 + 0.82 * Math.sqrt(value / max)).toFixed(2)})` : '#202023'

function heatCell(value, max, title) {
  const cell = document.createElement('div')
  cell.className = 'cell'
  cell.style.background = heat(value, max)
  cell.title = title
  return cell
}

function axisLabel(text, className = '') {
  const span = document.createElement('span')
  span.className = `axis ${className}`.trim()
  span.textContent = text
  return span
}

/** Weekday × hour-of-day totals over the selected period and providers. */
function renderHourHeatmap(periods) {
  const inPeriod = new Set(periods)
  const grid = Array.from({ length: 7 }, () => new Array(24).fill(0))
  for (const key of Object.keys(state.summary.hours)) {
    const [day, hour] = key.split('T')
    if (!inPeriod.has(day)) continue
    const row = (parseDay(day).getDay() + 6) % 7
    for (const entry of entriesIn(state.summary.hours, key)) grid[row][Number(hour)] += flatValue(entry)
  }
  const max = Math.max(...grid.flat(), 0)
  let peak = { row: 0, hour: 0, value: 0 }
  grid.forEach((cells, row) => cells.forEach((value, hour) => { if (value > peak.value) peak = { row, hour, value } }))

  const children = [axisLabel('')]
  for (let h = 0; h < 24; h++) children.push(axisLabel(h % 3 === 0 ? String(h) : '', 'col'))
  grid.forEach((cells, row) => {
    children.push(axisLabel(WEEKDAYS[row]))
    cells.forEach((value, hour) => {
      const when = `${WEEKDAYS[row]} ${String(hour).padStart(2, '0')}:00`
      children.push(heatCell(value, max, `${when} · ${fmtMetric(value)}`))
    })
  })
  $('hours-heatmap').replaceChildren(...children)
  $('hours-sub').textContent = peak.value > 0
    ? `Local time · peak ${WEEKDAYS[peak.row]} ${String(peak.hour).padStart(2, '0')}:00 (${fmtMetric(peak.value)})`
    : 'Local time'
}

/** Per-month totals by provider for the selected providers; ignores the period filter. */
function monthTotals() {
  const months = new Map()
  for (const day of Object.keys(state.summary.days).sort()) {
    for (const key of selectedProviders()) {
      const entry = state.summary.days[day][key]
      if (!entry) continue
      const month = months.get(day.slice(0, 7)) ?? Object.fromEntries(selectedProviders().map((k) => [k, 0]))
      month[key] += dayValue(entry)
      months.set(day.slice(0, 7), month)
    }
  }
  return months
}

/** Month-to-date and the straight-line projection to the end of the month. */
function monthPace(months) {
  const now = new Date()
  const key = dayKey.format(now).slice(0, 7)
  const sofar = Object.values(months.get(key) ?? {}).reduce((a, b) => a + b, 0)
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  return { key, sofar, elapsed: now.getDate(), daysInMonth, projected: (sofar / now.getDate()) * daysInMonth }
}

function renderMonths(months, pace) {
  const keys = [...months.keys()]
  const withNow = keys.includes(pace.key) ? keys : [...keys, pace.key]
  const totals = withNow.map((k) => Object.values(months.get(k) ?? {}).reduce((a, b) => a + b, 0))
  const showPace = isCost() && pace.sofar > 0
  const max = Math.max(...totals, showPace ? pace.projected : 0, 0)
  const columns = withNow.map((k, i) => {
    const [y, m] = k.split('-').map(Number)
    const col = document.createElement('div')
    col.className = 'month'
    col.innerHTML = '<div class="column"><div class="ghost" hidden></div><div class="stack"></div><div class="value"></div></div><div class="name"></div>'
    col.querySelector('.value').textContent = isCost() ? usdShort(totals[i]) : tokens(totals[i])
    col.querySelector('.name').textContent = monthLabel.format(new Date(y, m - 1, 1))
    const stack = col.querySelector('.stack')
    const top = k === pace.key && showPace ? pace.projected : totals[i]
    stack.style.height = max > 0 ? `${(totals[i] / max) * 100}%` : '0'
    col.querySelector('.value').style.bottom = max > 0 ? `calc(${(top / max) * 100}% + 4px)` : '0'
    for (const p of PROVIDERS) {
      const v = months.get(k)?.[p.key] ?? 0
      if (v <= 0) continue
      const seg = document.createElement('div')
      seg.style.flex = `${v} 1 0`
      seg.style.background = p.color
      seg.title = `${p.label} · ${fmtMetric(v)}`
      stack.append(seg)
    }
    col.title = `${monthLabel.format(new Date(y, m - 1, 1))} · ${fmtMetric(totals[i])}`
    if (k === pace.key && showPace) {
      const ghost = col.querySelector('.ghost')
      ghost.hidden = false
      ghost.style.height = `${(pace.projected / max) * 100}%`
      ghost.title = `On pace for ${usd(pace.projected)}`
      col.querySelector('.value').textContent = `${usdShort(totals[i])} → ${usdShort(pace.projected)}`
    }
    return col
  })
  $('months').replaceChildren(...columns)
  $('months-sub').textContent = showPace ? 'Dashed outline = on pace for the full month' : ''
}

/** GitHub-style grid of the last 365 days: columns are weeks, rows are weekdays (Mon first). */
function renderCalendar() {
  const end = new Date()
  end.setHours(12, 0, 0, 0)
  const start = new Date(end)
  start.setDate(start.getDate() - 364)
  const startRow = (start.getDay() + 6) % 7

  const cells = []
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = dayKey.format(d)
    const value = dayEntries(key).reduce((n, e) => n + dayValue(e), 0)
    const offset = Math.round((d - start) / 86_400_000)
    cells.push({ key, value, date: new Date(d), row: (d.getDay() + 6) % 7, col: Math.floor((offset + startRow) / 7) })
  }
  const weeks = cells[cells.length - 1].col + 1
  const max = Math.max(...cells.map((c) => c.value), 0)

  const children = [axisLabel('')]
  // One month label per month, at the first column it appears in; skip crowded ones.
  const labels = []
  for (const c of cells) {
    const month = c.date.getMonth()
    if (c.col === labels.at(-1)?.col || (labels.length && labels.at(-1).month === month)) continue
    labels.push({ col: c.col, month, text: monthLabel.format(c.date).split(' ')[0] })
  }
  if (labels.length > 1 && labels[1].col - labels[0].col < 3) labels.shift()
  for (const l of labels) {
    const span = axisLabel(l.text)
    span.style.gridRow = '1'
    span.style.gridColumn = String(l.col + 2)
    span.style.overflow = 'visible'
    children.push(span)
  }
  WEEKDAYS.forEach((name, row) => {
    if (row % 2 === 1) return
    const span = axisLabel(name)
    span.style.gridRow = String(row + 2)
    span.style.gridColumn = '1'
    children.push(span)
  })
  for (const c of cells) {
    const cell = heatCell(c.value, max, `${weekdayLabel.format(c.date)}, ${dayLabel.format(c.date)} · ${fmtMetric(c.value)}`)
    cell.style.gridRow = String(c.row + 2)
    cell.style.gridColumn = String(c.col + 2)
    children.push(cell)
  }
  const el = $('calendar')
  el.style.gridTemplateColumns = `28px repeat(${weeks}, 13px)`
  el.replaceChildren(...children)
  const total = cells.reduce((n, c) => n + c.value, 0)
  $('calendar-sub').textContent = `${fmtMetric(total)} · ${cells.filter((c) => c.value > 0).length} active days`
}

function renderExtraTiles(periods) {
  const months = monthTotals()
  const pace = monthPace(months)
  const monthTile = isCost()
    ? tile('This month so far', usd(pace.sofar), `on pace for ${usd(pace.projected)} · day ${pace.elapsed} of ${pace.daysInMonth}`)
    : tile('This month so far', tokens(pace.sofar), `on pace for ${tokens(pace.projected)} tokens · day ${pace.elapsed} of ${pace.daysInMonth}`)
  $('tiles-extra').replaceChildren(monthTile, valueTile(periods))
  renderMonths(months, pace)
}

/** API-equivalent cost against the plan price, prorated to the period, for providers with a plan. */
function valueTile(periods) {
  const edit = { label: 'Set plan prices', onClick: togglePlans }
  const priced = selectedProviders().filter((k) => state.plans[k] > 0)
  if (priced.length === 0) return tile('Value vs plan', '—', 'Compare API-equivalent cost to what you pay', edit)

  let apiCost = 0
  for (const p of periods) {
    for (const key of priced) {
      const day = state.summary.days[p]?.[key]
      if (day) apiCost += sum(day.costs)
    }
  }
  const plan = (priced.reduce((n, k) => n + state.plans[k], 0) * periods.length) / DAYS_PER_MONTH
  const skipped = selectedProviders().filter((k) => !priced.includes(k))
  const note = skipped.length ? ` · excludes ${sourceLabel(new Set(skipped))} (no plan price)` : ''
  return tile(
    'Value vs plan',
    `${(apiCost / plan).toFixed(1)}× value`,
    `API-equivalent ${usd(apiCost)} vs plan ${usd(plan)}${note}`,
    { label: 'Edit plan prices', onClick: togglePlans },
  )
}

function togglePlans() {
  const form = $('plans')
  form.hidden = !form.hidden
  $('plan-claude').value = state.plans.claude || ''
  $('plan-codex').value = state.plans.codex || ''
  if (!form.hidden) $('plan-claude').focus()
}

function savePlans(plans) {
  state.plans = plans
  localStorage.setItem(PLANS_KEY, JSON.stringify(plans))
  render()
}

function render() {
  if (!state.summary) return
  const periods = windowDays(state.summary.days, state.period)
  const agg = aggregate(periods)
  renderTiles(agg, periods)
  renderExtraTiles(periods)
  renderChart(agg, periods)
  if (state.provider === 'all') {
    shareBar($('share-provider'), 'Cost by source', PROVIDERS.map((p) => ({ ...p, value: agg.byProvider[p.key] })), usd)
  } else {
    $('share-provider').hidden = true
  }
  shareBar($('share-cost'), 'Cost by type', categorySegments(agg.totals.costs), usd)
  shareBar($('share-tokens'), 'Tokens by type', categorySegments(agg.totals.tokens), tokens)
  renderModels(agg)
  renderProjects(periods)
  renderSessions(periods)
  renderHourHeatmap(periods)
  renderCalendar()
}

async function load({ rescan = false } = {}) {
  const meta = $('meta')
  const refresh = $('refresh')
  refresh.classList.add('spinning')
  meta.className = 'muted'
  try {
    state.summary = await window.usage.summary({ profile: state.profile, rescan })
    const s = state.summary
    meta.textContent = [
      ...PROVIDERS.map(({ key, label }) => {
        const p = s.providers[key]
        return `${label}: ${p.records.toLocaleString()} responses in ${p.files.toLocaleString()} files${p.unpriced ? `, ${p.unpriced} unpriced` : ''}`
      }),
      s.profile !== 'anthropic' && `Claude priced as ${s.profiles[s.profile]}`,
      s.fellBackModels.length && `${s.fellBackModels.join(', ')} at API rates (no Bedrock price)`,
      `updated ${new Date(s.readAt).toLocaleTimeString()}`,
    ].filter(Boolean).join(' · ')
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
segmented('provider', 'provider')
segmented('resolution', 'resolution')
$('plans').addEventListener('submit', (event) => {
  event.preventDefault()
  savePlans({ claude: positive($('plan-claude').value), codex: positive($('plan-codex').value) })
})
$('plans-clear').addEventListener('click', () => {
  $('plan-claude').value = ''
  $('plan-codex').value = ''
  savePlans({ claude: 0, codex: 0 })
})
$('refresh').addEventListener('click', () => load({ rescan: true }))
$('profile').addEventListener('change', (event) => {
  state.profile = event.target.value
  load()
})
load()
