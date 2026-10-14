const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

function rows(table, entries) {
  table.replaceChildren(
    ...entries.map(([label, cost]) => {
      const tr = document.createElement('tr')
      for (const text of [label, usd.format(cost)]) {
        const td = document.createElement('td')
        td.textContent = text
        tr.append(td)
      }
      return tr
    }),
  )
}

async function load() {
  const meta = document.getElementById('meta')
  meta.className = 'meta'
  meta.textContent = 'Scanning transcripts…'
  try {
    const s = await window.usage.summary()
    document.getElementById('total').textContent = usd.format(s.total)
    meta.textContent = `${s.records.toLocaleString()} responses · ${s.files} files · ${s.unpriced} unpriced`
    rows(document.getElementById('days'), Object.entries(s.days).sort().reverse().slice(0, 14))
    rows(document.getElementById('models'), Object.entries(s.models).sort((a, b) => b[1] - a[1]))
  } catch (err) {
    meta.className = 'meta error'
    meta.textContent = String(err)
  }
}

document.getElementById('refresh').addEventListener('click', load)
load()
