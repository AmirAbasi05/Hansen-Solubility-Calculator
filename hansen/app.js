const state = {
  solvent: { common: [], all: [], index: null, selected: null },
  polymer: { common: [], all: [], index: null, selected: null },
};

// --- normalize ---
const normalizeSolvent = x => ({
  id: x.id ?? x.No ?? null,
  name: (x.name ?? x['Solvent Name'] ?? x.Solvent ?? '').replace(/<br\s*\/?>/gi, ' ').trim(),
  acdName: (x.acdName ?? x['Autonom/ACD Name'] ?? '').trim(),
  d: x.d ?? x.Dispersion,
  p: x.p ?? x.Polarity ?? x.Polar,
  h: x.h ?? x['Hydrogen Bonding'],
  mv: x.mv ?? x['Molar Volume'],
});

const normalizePolymer = x => ({
  id: x.id ?? x.Number ?? null,
  name: (x.name ?? x.Polymer ?? '').replace(/<br\s*\/?>/gi, ' ').trim(),
  d: x.d ?? x.Dispersion,
  p: x.p ?? x.Polar ?? x.Polarity,
  h: x.h ?? x['Hydrogen Bonding'],
  r0: x.r0 ?? x['Interaction Radius'],
});

function normalizeAll(arr, fn) {
  return arr.map((x, i) => {
    const n = fn(x);
    n.sourceId = n.id;
    n.id = i + 1;
    return n;
  });
}

async function init() {
  const [sC, sA, pC, pA] = await Promise.all([
    fetch('data/solvents_common.json').then(r => r.json()),
    fetch('data/solvents_all.json').then(r => r.json()),
    fetch('data/polymers_common.json').then(r => r.json()),
    fetch('data/polymers_all.json').then(r => r.json()),
  ]);

  state.solvent.common = normalizeAll(sC, normalizeSolvent);
  state.solvent.all    = normalizeAll(sA, normalizeSolvent);
  state.polymer.common = normalizeAll(pC, normalizePolymer);
  state.polymer.all    = normalizeAll(pA, normalizePolymer);

  state.solvent.index = new MiniSearch({
    fields: ['name', 'acdName'],
    storeFields: ['id'],
    searchOptions: { prefix: true, fuzzy: 0.2, boost: { name: 2 } }
  });
  state.solvent.index.addAll(state.solvent.all);

  state.polymer.index = new MiniSearch({
    fields: ['name'],
    storeFields: ['id'],
    searchOptions: { prefix: true, fuzzy: 0.2 }
  });
  state.polymer.index.addAll(state.polymer.all);

  setupCommon('solvent');
  setupCommon('polymer');
  setupSearch('solvent');
  setupSearch('polymer');
}

// --- Common dropdown ---
function setupCommon(kind) {
  const sel = document.getElementById(`${kind}-common`);
  const list = state[kind].common;
  sel.innerHTML = `<option value="">— Common ${kind}s (${list.length}) —</option>` +
    list.map((item, i) => `<option value="${i}">${escapeHtml(item.name)}</option>`).join('');

  sel.addEventListener('change', () => {
    if (sel.value === '') return;
    const item = list[Number(sel.value)];
    if (item) selectItem(kind, item);
  });
}

// --- Full search ---
function setupSearch(kind) {
  const input = document.getElementById(`${kind}-search`);
  const results = document.getElementById(`${kind}-results`);
  let timer;

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) { results.innerHTML = ''; results.classList.remove('open'); return; }
    timer = setTimeout(() => runSearch(kind, q), 100);
  });
  input.addEventListener('focus', () => {
    if (input.value.trim()) results.classList.add('open');
  });
  document.addEventListener('click', e => {
    if (!e.target.closest(`#${kind}-search`) && !e.target.closest(`#${kind}-results`))
      results.classList.remove('open');
  });
}

function runSearch(kind, q) {
  const results = document.getElementById(`${kind}-results`);
  const hits = state[kind].index.search(q).slice(0, 10);
  const data = state[kind].all;
  const commonNames = new Set(state[kind].common.map(c => c.name));

  if (!hits.length) {
    results.innerHTML = '<li class="empty">No results</li>';
    results.classList.add('open');
    return;
  }

  results.innerHTML = hits.map(hit => {
    const item = data.find(x => x.id === hit.id);
    if (!item) return '';
    const isCommon = commonNames.has(item.name);
    const sub = kind === 'solvent'
      ? escapeHtml(item.acdName || '')
      : `D:${item.d ?? '—'}  P:${item.p ?? '—'}  H:${item.h ?? '—'}`;
    return `<li data-id="${item.id}">
      <span class="name">${escapeHtml(item.name)}${isCommon ? '<span class="badge">common</span>' : ''}</span>
      <span class="sub">${sub}</span>
    </li>`;
  }).join('');
  results.classList.add('open');

  results.querySelectorAll('li[data-id]').forEach(li => {
    li.addEventListener('click', () => {
      const item = data.find(x => x.id === Number(li.dataset.id));
      if (item) selectItem(kind, item);
    });
  });
}

// --- Select / clear ---
function selectItem(kind, item) {
  state[kind].selected = item;

  const selEl = document.getElementById(`${kind}-selected`);
  selEl.innerHTML = `✓ ${escapeHtml(item.name)} <button class="clear" title="Clear">×</button>`;
  selEl.classList.add('show');
  selEl.querySelector('.clear').addEventListener('click', e => {
    e.stopPropagation();
    clearSelection(kind);
  });

  const sel = document.getElementById(`${kind}-common`);
  const idx = state[kind].common.findIndex(c => c.name === item.name);
  sel.value = idx >= 0 ? String(idx) : '';

  document.getElementById(`${kind}-search`).value = '';
  const results = document.getElementById(`${kind}-results`);
  results.innerHTML = '';
  results.classList.remove('open');

  update();
}

function clearSelection(kind) {
  state[kind].selected = null;
  const selEl = document.getElementById(`${kind}-selected`);
  selEl.textContent = '';
  selEl.classList.remove('show');
  document.getElementById(`${kind}-common`).value = '';
  update();
}

// --- Hansen math ---
function ra(s, p) {
  return Math.sqrt(4 * (s.d - p.d) ** 2 + (s.p - p.p) ** 2 + (s.h - p.h) ** 2);
}
function interpret(red) {
  if (red < 0.8) return { cls: 'status-sol', label: 'Excellent solvent' };
  if (red < 1.0) return { cls: 'status-sol', label: 'Soluble' };
  if (red < 1.1) return { cls: 'status-brd', label: 'Borderline' };
  return { cls: 'status-ins', label: 'Insoluble' };
}
function canCompare(a, b) {
  return a.d != null && a.p != null && a.h != null &&
         b.d != null && b.p != null && b.h != null;
}

// --- Hansen 3D sphere ---
function drawHansenSphere(polymer, solvent) {
  const el = document.getElementById('hansen-3d');
  if (!el || !polymer || !polymer.r0) return;

  const px = 2 * polymer.d;
  const py = polymer.p;
  const pz = polymer.h;
  const r0 = polymer.r0;
  const traces = [];

  // 1) Solubility sphere
  const n = 40;
  const xs = [], ys = [], zs = [];
  for (let i = 0; i <= n; i++) {
    const phi = Math.PI * i / n;
    const xr = [], yr = [], zr = [];
    for (let j = 0; j <= n; j++) {
      const theta = 2 * Math.PI * j / n;
      xr.push(px + r0 * Math.sin(phi) * Math.cos(theta));
      yr.push(py + r0 * Math.sin(phi) * Math.sin(theta));
      zr.push(pz + r0 * Math.cos(phi));
    }
    xs.push(xr); ys.push(yr); zs.push(zr);
  }
  traces.push({
    type: 'surface', x: xs, y: ys, z: zs,
    opacity: 0.14,
    colorscale: [[0, '#6366f1'], [1, '#6366f1']],
    showscale: false,
    name: 'Solubility sphere (R₀)',
    hoverinfo: 'skip',
  });

  // 2) Top 10 solvents
  const top = state.solvent.all
    .filter(s => canCompare(s, polymer))
    .map(s => {
      const r = ra(s, polymer);
      return { s, ra: r, red: polymer.r0 ? r / polymer.r0 : null };
    })
    .sort((a, b) => a.ra - b.ra)
    .slice(0, 10);

  const tX = [], tY = [], tZ = [], tText = [], tColor = [], tSize = [];
  top.forEach(t => {
    const inside = t.red != null && t.red < 1;
    tX.push(2 * t.s.d);
    tY.push(t.s.p);
    tZ.push(t.s.h);
    tText.push(
      `<b>${escapeHtml(t.s.name)}</b><br>` +
      `Ra = ${t.ra.toFixed(2)}` +
      (t.red != null ? `<br>RED = ${t.red.toFixed(2)}` : '') +
      `<br>${inside ? '✅ soluble' : '❌ insoluble'}`
    );
    tColor.push(inside ? '#10b981' : '#ef4444');
    tSize.push(inside ? 9 : 6);
  });
  traces.push({
    type: 'scatter3d', mode: 'markers',
    x: tX, y: tY, z: tZ, text: tText, hoverinfo: 'text',
    marker: {
      size: tSize, color: tColor, opacity: 0.65,
      line: { color: '#fff', width: 1 },
    },
    name: 'Top 10 solvents',
  });

  // 3) Polymer center
  traces.push({
    type: 'scatter3d', mode: 'markers+text',
    x: [px], y: [py], z: [pz],
    text: [polymer.name], textposition: 'top center',
    textfont: { size: 12, color: '#0f172a' },
    marker: {
      size: 11, color: '#6366f1', symbol: 'diamond',
      line: { color: '#fff', width: 2 },
    },
    hovertext: `<b>${escapeHtml(polymer.name)}</b><br>R₀ = ${r0}`,
    hoverinfo: 'text',
    name: 'Polymer',
  });

  // 4) Selected solvent + line
  if (solvent && canCompare(solvent, polymer)) {
    const sx = 2 * solvent.d;
    const sy = solvent.p;
    const sz = solvent.h;
    const rSel = ra(solvent, polymer);
    const redSel = polymer.r0 ? rSel / polymer.r0 : null;
    const inside = redSel != null && redSel < 1;

    traces.push({
      type: 'scatter3d', mode: 'lines',
      x: [px, sx], y: [py, sy], z: [pz, sz],
      line: { color: '#64748b', width: 3, dash: 'dash' },
      hoverinfo: 'skip', showlegend: false,
    });

    traces.push({
      type: 'scatter3d', mode: 'markers+text',
      x: [sx], y: [sy], z: [sz],
      text: [solvent.name], textposition: 'top center',
      textfont: { size: 13, color: inside ? '#059669' : '#dc2626' },
      marker: {
        size: 13, color: inside ? '#10b981' : '#ef4444',
        line: { color: '#fff', width: 2 },
      },
      hovertext:
        `<b>${escapeHtml(solvent.name)}</b><br>` +
        `Ra = ${rSel.toFixed(2)}` +
        (redSel != null ? `<br>RED = ${redSel.toFixed(2)}` : '') +
        `<br>${inside ? '✅ soluble' : '❌ insoluble'}`,
      hoverinfo: 'text',
      name: inside ? 'Selected (soluble)' : 'Selected (insoluble)',
    });
  }

  const layout = {
    scene: {
      xaxis: { title: 'δD × 2', gridcolor: '#e5e7eb', zerolinecolor: '#d1d5db' },
      yaxis: { title: 'δP',     gridcolor: '#e5e7eb', zerolinecolor: '#d1d5db' },
      zaxis: { title: 'δH',     gridcolor: '#e5e7eb', zerolinecolor: '#d1d5db' },
      aspectmode: 'cube',
      camera: { eye: { x: 1.6, y: 1.6, z: 1.2 } },
    },
    margin: { l: 0, r: 0, t: 0, b: 0 },
    showlegend: true,
    legend: {
      x: 0.01, y: 0.99,
      bgcolor: 'rgba(255,255,255,.92)',
      bordercolor: '#e5e7eb', borderwidth: 1,
      font: { size: 10 },
    },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { family: 'Inter, system-ui, sans-serif', size: 11, color: '#0f172a' },
  };

  Plotly.react('hansen-3d', traces, layout, {
    displayModeBar: true,
    displaylogo: false,
    modeBarButtonsToRemove: ['toImage', 'sendDataToCloud'],
    responsive: true,
  });
}

function update() {
  const resultPanel = document.getElementById('result-panel');
  const bestPanel = document.getElementById('best-solvents');
  const spherePanel = document.getElementById('sphere-panel');
  const p = state.polymer.selected;

  if (!p) {
    resultPanel.classList.add('hidden');
    bestPanel.classList.add('hidden');
    spherePanel.classList.add('hidden');
    return;
  }

  // Best solvents
  const scored = state.solvent.all
    .filter(s => canCompare(s, p))
    .map(s => {
      const r = ra(s, p);
      return { s, ra: r, red: p.r0 ? r / p.r0 : null };
    })
    .sort((a, b) => a.ra - b.ra)
    .slice(0, 10);

  bestPanel.innerHTML = `
    <h2>Best solvents for ${escapeHtml(p.name)}${p.r0 ? ` <span class="meta">R₀ = ${p.r0}</span>` : ''}</h2>
    <table>
      <thead><tr><th>#</th><th>Solvent</th><th class="num">Ra</th><th class="num">RED</th><th>Status</th></tr></thead>
      <tbody>
        ${scored.map((x, i) => {
          const it = x.red != null ? interpret(x.red) : null;
          return `<tr class="row-clickable" data-id="${x.s.id}">
            <td class="num">${i + 1}</td>
            <td>${escapeHtml(x.s.name)}</td>
            <td class="num">${x.ra.toFixed(2)}</td>
            <td class="num">${x.red != null ? x.red.toFixed(2) : '—'}</td>
            <td class="${it ? it.cls : ''}">${it ? it.label : 'R₀ missing'}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  `;
  bestPanel.classList.remove('hidden');

  bestPanel.querySelectorAll('tr[data-id]').forEach(tr => {
    tr.addEventListener('click', () => {
      const item = state.solvent.all.find(s => s.id === Number(tr.dataset.id));
      if (item) selectItem('solvent', item);
    });
  });

  // 3D sphere
  if (p.r0 != null && p.d != null && p.p != null && p.h != null) {
    spherePanel.classList.remove('hidden');
    requestAnimationFrame(() => drawHansenSphere(p, state.solvent.selected));
  } else {
    spherePanel.classList.add('hidden');
  }

  // Selected pair
  const s = state.solvent.selected;
  if (!s) { resultPanel.classList.add('hidden'); return; }
  if (!canCompare(s, p)) {
    resultPanel.innerHTML = `<h2>Missing data</h2><p>Selected items have missing D/P/H values.</p>`;
    resultPanel.classList.remove('hidden');
    return;
  }

  const r = ra(s, p);
  const red = p.r0 ? r / p.r0 : null;
  const it = red != null ? interpret(red) : null;
  const dD = s.d - p.d, dP = s.p - p.p, dH = s.h - p.h;

  resultPanel.innerHTML = `
    <h2>${escapeHtml(s.name)} <span class="meta">+</span> ${escapeHtml(p.name)}</h2>
    <div class="metrics">
      <div class="metric"><span class="label">Ra</span><span class="value">${r.toFixed(2)}</span></div>
      <div class="metric"><span class="label">RED</span><span class="value">${red != null ? red.toFixed(2) : '—'}</span></div>
      <div class="metric"><span class="label">R₀</span><span class="value">${p.r0 ?? '—'}</span></div>
      <div class="metric"><span class="label">Status</span><span class="value ${it ? it.cls : ''}">${it ? it.label : 'N/A'}</span></div>
    </div>
    <div class="deltas">
      <span><b>ΔD</b> ${dD.toFixed(2)}</span>
      <span><b>ΔP</b> ${dP.toFixed(2)}</span>
      <span><b>ΔH</b> ${dH.toFixed(2)}</span>
    </div>
  `;
  resultPanel.classList.remove('hidden');
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g,
    c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

init().catch(err => {
  console.error(err);
  document.body.insertAdjacentHTML('afterbegin',
    `<div style="color:#c00;background:#fee;padding:1rem;border-radius:8px;margin-bottom:1rem">
      <b>Error:</b> ${escapeHtml(err.message)}<br>
      <small>Serve via a local server (e.g. <code>python -m http.server 8000</code>), not file://</small>
    </div>`);
});