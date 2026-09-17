const dropZone = document.getElementById('drop-zone');
const dropTitle = document.getElementById('drop-title');
const fileInput = document.getElementById('file-input');
const analyzeBtn = document.getElementById('analyze-btn');
const message = document.getElementById('upload-message');
const emptyState = document.getElementById('empty-state');
const results = document.getElementById('results');
const kpiStrip = document.getElementById('kpi-strip');
const tableBody = document.querySelector('#campaign-table tbody');
const tableNote = document.getElementById('table-note');

let selectedFile = null;
let timeseriesChart = null;
let roasChart = null;
let serverWarm = false;

// Ping the server as soon as the page loads so a sleeping free-tier
// instance has time to wake up before the person clicks Analyze.
(async function warmUp() {
  try {
    await fetch('/api/sample-csv', { method: 'HEAD' });
    serverWarm = true;
  } catch (e) {
    // Ignore — the real request will still be attempted and will
    // show its own message if the server truly can't be reached.
  }
})();

const money = (n) => '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const number = (n) => Number(n).toLocaleString('en-IN');

function setFile(file) {
  selectedFile = file;
  dropTitle.textContent = file ? file.name : 'Drop a CSV here, or choose a file';
  analyzeBtn.disabled = !file;
  message.textContent = '';
  message.className = 'upload-message';
}

fileInput.addEventListener('change', (e) => setFile(e.target.files[0] || null));

['dragover', 'dragleave', 'drop'].forEach((evt) => {
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropZone.classList.toggle('dragover', evt === 'dragover');
  });
});

dropZone.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files[0];
  if (file) setFile(file);
});

analyzeBtn.addEventListener('click', async () => {
  if (!selectedFile) return;

  analyzeBtn.disabled = true;
  analyzeBtn.textContent = serverWarm ? 'Analyzing…' : 'Waking up server (can take ~30s)…';
  message.textContent = '';
  message.className = 'upload-message';

  const formData = new FormData();
  formData.append('file', selectedFile);

  try {
    const res = await fetch('/api/analyze', { method: 'POST', body: formData });

    let data;
    try {
      data = await res.json();
    } catch (parseErr) {
      // The response wasn't JSON — almost always the hosting platform's
      // own timeout/error page from a slow cold start, not a real bug.
      message.textContent = res.status
        ? `The server responded with an unexpected page (status ${res.status}). ` +
          `If the site had been idle, it may still be waking up — wait a few seconds and try again.`
        : 'The server sent back something unreadable. Please try again in a moment.';
      message.className = 'upload-message error';
      return;
    }

    if (!res.ok) {
      message.textContent = data.error || 'Something went wrong reading that file.';
      message.className = 'upload-message error';
      return;
    }

    serverWarm = true;
    message.textContent = `Analyzed ${data.meta.rows_used.toLocaleString()} rows` +
      (data.meta.rows_dropped ? ` (${data.meta.rows_dropped} skipped for an unreadable date).` : '.');
    message.className = 'upload-message ok';

    renderResults(data);
  } catch (err) {
    message.textContent = serverWarm
      ? 'Could not reach the server. Check your internet connection and try again.'
      : 'Could not reach the server yet — it may still be waking up from being idle. Wait ~20 seconds and click Analyze again.';
    message.className = 'upload-message error';
  } finally {
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = 'Analyze campaign data';
  }
});

function renderResults(data) {
  emptyState.hidden = true;
  results.hidden = false;

  renderKpis(data.kpis);
  renderTimeseriesChart(data.timeseries);
  renderRoasChart(data.campaigns);
  renderTable(data.campaigns);
}

function renderKpis(kpis) {
  const roasClass = kpis.roas >= 3 ? 'good' : kpis.roas < 1 ? 'alert' : '';

  const entries = [
    ['Total spend', money(kpis.spend), ''],
    ['Total revenue', money(kpis.revenue), ''],
    ['Return on ad spend', kpis.roas.toFixed(2) + '×', roasClass],
    ['Click-through rate', kpis.ctr.toFixed(2) + '%', ''],
    ['Cost per click', money(kpis.cpc), ''],
    ['Cost per acquisition', money(kpis.cpa), ''],
  ];

  kpiStrip.innerHTML = entries.map(([label, value, cls]) => `
    <div class="kpi-entry">
      <span class="kpi-value ${cls}">${value}</span>
      <span class="kpi-label">${label}</span>
    </div>
  `).join('');
}

function chartTheme() {
  const gridColor = 'rgba(139, 148, 163, 0.15)';
  const textColor = '#8b94a3';
  Chart.defaults.font.family = "'IBM Plex Mono', monospace";
  Chart.defaults.color = textColor;
  return { gridColor, textColor };
}

function renderTimeseriesChart(ts) {
  const { gridColor } = chartTheme();
  const ctx = document.getElementById('chart-timeseries');
  if (timeseriesChart) timeseriesChart.destroy();

  timeseriesChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: ts.dates,
      datasets: [
        {
          label: 'Spend',
          data: ts.spend,
          borderColor: '#f2a340',
          backgroundColor: 'rgba(242, 163, 64, 0.08)',
          tension: 0.25,
          fill: true,
          pointRadius: 0,
        },
        {
          label: 'Revenue',
          data: ts.revenue,
          borderColor: '#4fb286',
          backgroundColor: 'rgba(79, 178, 134, 0.08)',
          tension: 0.25,
          fill: true,
          pointRadius: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'top', labels: { boxWidth: 12, usePointStyle: true } } },
      scales: {
        x: { grid: { color: gridColor }, ticks: { maxRotation: 0, autoSkip: true } },
        y: { grid: { color: gridColor }, ticks: { callback: (v) => '₹' + v } },
      },
    },
  });
}

function renderRoasChart(campaigns) {
  const { gridColor } = chartTheme();
  const ctx = document.getElementById('chart-roas');
  if (roasChart) roasChart.destroy();

  const sorted = [...campaigns].sort((a, b) => b.roas - a.roas);

  roasChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: sorted.map((c) => c.campaign),
      datasets: [
        {
          label: 'ROAS',
          data: sorted.map((c) => c.roas),
          backgroundColor: sorted.map((c) => (c.roas >= 1 ? '#4fb286' : '#e5605a')),
          borderRadius: 3,
          maxBarThickness: 48,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false } },
        y: { grid: { color: gridColor }, ticks: { callback: (v) => v + '×' } },
      },
    },
  });
}

function renderTable(campaigns) {
  const sorted = [...campaigns].sort((a, b) => b.spend - a.spend);

  tableBody.innerHTML = sorted.map((c) => `
    <tr>
      <td>${c.campaign}</td>
      <td>${money(c.spend)}</td>
      <td>${money(c.revenue)}</td>
      <td>${c.roas.toFixed(2)}×</td>
      <td>${c.ctr.toFixed(2)}%</td>
      <td>${money(c.cpc)}</td>
      <td>${money(c.cpa)}</td>
    </tr>
  `).join('');

  tableNote.textContent = `${sorted.length} campaign${sorted.length === 1 ? '' : 's'}, sorted by spend.`;
}
