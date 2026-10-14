// Hand-rolled SVG area chart, modeled on T3 Code's UsageProviderChart:
// one translucent fill plus a crisp line per series, monotone cubic curves,
// HTML axis labels outside the stretched SVG, and a crosshair tooltip.
;(() => {
  const W = 960
  const H = 260
  const TOP = 8
  const TICKS = 4
  const SVG_NS = 'http://www.w3.org/2000/svg'

  // Shape-preserving tangents (Fritsch–Carlson): curves never overshoot spiky data.
  function monotoneTangents(points) {
    const n = points.length
    if (n < 2) return [0]
    const slopes = []
    for (let i = 0; i < n - 1; i++) {
      const dx = points[i + 1].x - points[i].x
      slopes.push(dx === 0 ? 0 : (points[i + 1].y - points[i].y) / dx)
    }
    const t = new Array(n).fill(0)
    t[0] = slopes[0]
    t[n - 1] = slopes[n - 2]
    for (let i = 1; i < n - 1; i++) {
      t[i] = slopes[i - 1] * slopes[i] <= 0 ? 0 : (slopes[i - 1] + slopes[i]) / 2
    }
    for (let i = 0; i < n - 1; i++) {
      const s = slopes[i]
      if (s === 0) {
        t[i] = 0
        t[i + 1] = 0
        continue
      }
      const a = t[i] / s
      const b = t[i + 1] / s
      const m = a * a + b * b
      if (m > 9) {
        const k = 3 / Math.sqrt(m)
        t[i] = k * a * s
        t[i + 1] = k * b * s
      }
    }
    return t
  }

  function curvePath(points) {
    if (points.length === 0) return ''
    if (points.length === 1) return `M${points[0].x},${points[0].y}`
    const t = monotoneTangents(points)
    let d = `M${points[0].x},${points[0].y}`
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]
      const b = points[i + 1]
      const dx = b.x - a.x
      d += `C${a.x + dx / 3},${a.y + (t[i] * dx) / 3} ${b.x - dx / 3},${b.y - (t[i + 1] * dx) / 3} ${b.x},${b.y}`
    }
    return d
  }

  // A rounded 1/2/2.5/5 × 10^k ceiling so gridlines land on readable values.
  function niceMax(value) {
    if (value <= 0) return 1
    const exp = Math.floor(Math.log10(value / TICKS))
    const base = 10 ** exp
    for (const step of [1, 2, 2.5, 5, 10]) {
      if (step * base * TICKS >= value) return step * base * TICKS
    }
    return 10 * base * TICKS
  }

  function el(name, attrs) {
    const node = document.createElementNS(SVG_NS, name)
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
    return node
  }

  /**
   * @param {object} opts
   * @param {string[]} opts.periods          x-axis keys (days)
   * @param {{key:string,label:string,color:string,values:number[]}[]} opts.series
   * @param {(n:number)=>string} opts.format value formatter
   * @param {(period:string)=>string} opts.formatPeriod
   * @param {{svg,plot,yAxis,xAxis,crosshair,tooltip}} opts.nodes
   */
  function render({ periods, series, format, formatPeriod, nodes }) {
    const { svg, plot, yAxis, xAxis, crosshair, tooltip } = nodes
    const n = periods.length
    const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)))
    const stepX = n > 1 ? W / (n - 1) : 0
    const toY = (v) => TOP + (H - TOP) * (1 - v / max)
    const ticks = Array.from({ length: TICKS + 1 }, (_, i) => (max / TICKS) * i)

    svg.setAttribute('viewBox', `0 0 ${W} ${H}`)
    svg.setAttribute('preserveAspectRatio', 'none')
    svg.replaceChildren()
    for (const tick of ticks) {
      svg.append(el('line', {
        x1: 0, x2: W, y1: toY(tick), y2: toY(tick),
        stroke: '#2a2a2d', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke',
      }))
    }

    const lines = series.map((s) => curvePath(s.values.map((v, i) => ({ x: i * stepX, y: toY(v) }))))
    // Fills first, then every stroke, so no series covers another's line.
    series.forEach((s, i) => {
      if (n < 2) return
      svg.append(el('path', { d: `${lines[i]}L${W},${H}L0,${H}Z`, fill: s.color, 'fill-opacity': 0.12 }))
    })
    series.forEach((s, i) => {
      svg.append(el('path', {
        d: lines[i], fill: 'none', stroke: s.color, 'stroke-width': 2,
        'vector-effect': 'non-scaling-stroke', 'stroke-linejoin': 'round',
      }))
    })

    yAxis.replaceChildren(
      ...ticks.map((tick) => {
        const span = document.createElement('span')
        span.style.top = `${(toY(tick) / H) * 100}%`
        span.textContent = tick === 0 ? '0' : format(tick)
        return span
      }),
    )

    const labelIdx = n <= 1 ? [0] : [0, Math.floor((n - 1) / 2), n - 1]
    xAxis.replaceChildren(
      ...[...new Set(labelIdx)].filter((i) => periods[i]).map((i) => {
        const span = document.createElement('span')
        span.textContent = formatPeriod(periods[i])
        return span
      }),
    )

    plot.onmousemove = (event) => {
      if (n === 0) return
      const box = plot.getBoundingClientRect()
      const ratio = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width))
      const i = Math.round(ratio * (n - 1))
      const x = n > 1 ? (i / (n - 1)) * box.width : box.width / 2
      crosshair.hidden = false
      crosshair.style.left = `${x}px`

      const rows = series
        .map((s) => ({ s, v: s.values[i] }))
        .filter((r) => r.v > 0)
        .sort((a, b) => b.v - a.v)
      const total = rows.reduce((sum, r) => sum + r.v, 0)
      tooltip.replaceChildren()
      const when = document.createElement('div')
      when.className = 'when'
      when.textContent = formatPeriod(periods[i])
      tooltip.append(when)
      for (const { s, v } of rows) tooltip.append(row(s.label, format(v), s.color))
      const totalRow = row('Total', format(total))
      totalRow.classList.add('total')
      tooltip.append(totalRow)
      tooltip.hidden = false
      const tipWidth = tooltip.offsetWidth
      const left = x + 12 + tipWidth > box.width ? x - 12 - tipWidth : x + 12
      tooltip.style.left = `${Math.max(0, left)}px`
    }
    plot.onmouseleave = () => {
      crosshair.hidden = true
      tooltip.hidden = true
    }
  }

  function row(label, value, color) {
    const div = document.createElement('div')
    div.className = 'row'
    const name = document.createElement('span')
    if (color) {
      const sw = document.createElement('i')
      sw.className = 'swatch'
      sw.style.background = color
      name.append(sw)
    }
    name.append(label)
    const b = document.createElement('b')
    b.textContent = value
    div.append(name, b)
    return div
  }

  window.UsageChart = { render }
})()
