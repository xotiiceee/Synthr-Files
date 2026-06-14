/**
 * Localhost HTML dashboard — serves a single-page analytics view.
 * Run standalone: npx tsx src/analytics/dashboard.ts
 * Serves on http://localhost:3500
 */

import http from 'node:http';
import { getStats, type Stats } from './tracker.js';
import { getActions } from '../core/state.js';

const PORT = 3500;

// ─── Data Helpers ───────────────────────────────────────────────────────────

function getDailyReplies(): Record<string, number> {
  const actions = getActions();
  const daily: Record<string, number> = {};
  for (const a of actions) {
    if (a.type !== 'reply' || a.platform === 'system') continue;
    const day = a.timestamp.slice(0, 10);
    daily[day] = (daily[day] ?? 0) + 1;
  }
  return daily;
}

// ─── HTML Template ──────────────────────────────────────────────────────────

function buildHTML(): string {
  const weekStats = getStats('week');
  const monthStats = getStats('month');
  const dailyReplies = getDailyReplies();

  // Last 14 days for bar chart
  const days: string[] = [];
  const replyCounts: number[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
    days.push(d.slice(5)); // MM-DD
    replyCounts.push(dailyReplies[d] ?? 0);
  }

  const platformLabels = Object.keys(weekStats.byPlatform);
  const platformValues = Object.values(weekStats.byPlatform);

  const topicEntries = Object.entries(monthStats.byTopic)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  const topicLabels = topicEntries.map(([t]) => t);
  const topicValues = topicEntries.map(([, v]) => v);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="60">
<title>PULSE Dashboard</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #0d1117; color: #c9d1d9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; padding: 24px; }
  h1 { color: #58a6ff; font-size: 1.8rem; margin-bottom: 4px; }
  .subtitle { color: #8b949e; font-size: 0.85rem; margin-bottom: 24px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px; }
  .card h2 { color: #58a6ff; font-size: 0.9rem; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px; }
  .stat { font-size: 2.2rem; font-weight: 700; color: #f0f6fc; }
  .stat-label { color: #8b949e; font-size: 0.8rem; }
  .chart-card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px; margin-bottom: 16px; }
  .chart-card h2 { color: #58a6ff; font-size: 0.9rem; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px; }
  .charts { display: grid; grid-template-columns: 2fr 1fr; gap: 16px; margin-bottom: 16px; }
  canvas { max-height: 300px; }
  @media (max-width: 768px) { .charts { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<h1>PULSE</h1>
<p class="subtitle">AI Marketing Agent Dashboard &mdash; auto-refreshes every 60s</p>

<div class="grid">
  <div class="card">
    <h2>This Week</h2>
    <div class="stat">${weekStats.totalActions}</div>
    <div class="stat-label">total actions</div>
  </div>
  <div class="card">
    <h2>Replies</h2>
    <div class="stat">${weekStats.byType['reply'] ?? 0}</div>
    <div class="stat-label">conversations joined</div>
  </div>
  <div class="card">
    <h2>Posts</h2>
    <div class="stat">${weekStats.byType['post'] ?? 0}</div>
    <div class="stat-label">original content</div>
  </div>
  <div class="card">
    <h2>Avg Engagement</h2>
    <div class="stat">${weekStats.avgEngagement}</div>
    <div class="stat-label">per action</div>
  </div>
</div>

<div class="charts">
  <div class="chart-card">
    <h2>Replies Per Day (Last 14 Days)</h2>
    <canvas id="dailyChart"></canvas>
  </div>
  <div class="chart-card">
    <h2>By Platform (Week)</h2>
    <canvas id="platformChart"></canvas>
  </div>
</div>

<div class="chart-card">
  <h2>Topic Performance (Month)</h2>
  <canvas id="topicChart"></canvas>
</div>

<script>
const chartColors = ['#58a6ff','#3fb950','#d29922','#f85149','#bc8cff','#79c0ff','#56d364','#e3b341'];
const gridColor = '#21262d';
const textColor = '#8b949e';

Chart.defaults.color = textColor;
Chart.defaults.borderColor = gridColor;

new Chart(document.getElementById('dailyChart'), {
  type: 'bar',
  data: {
    labels: ${JSON.stringify(days)},
    datasets: [{
      label: 'Replies',
      data: ${JSON.stringify(replyCounts)},
      backgroundColor: '#58a6ff',
      borderRadius: 4,
    }]
  },
  options: {
    responsive: true,
    plugins: { legend: { display: false } },
    scales: {
      y: { beginAtZero: true, ticks: { stepSize: 1 } },
    },
  },
});

new Chart(document.getElementById('platformChart'), {
  type: 'doughnut',
  data: {
    labels: ${JSON.stringify(platformLabels)},
    datasets: [{
      data: ${JSON.stringify(platformValues)},
      backgroundColor: chartColors.slice(0, ${platformLabels.length}),
      borderWidth: 0,
    }]
  },
  options: {
    responsive: true,
    plugins: {
      legend: { position: 'bottom', labels: { padding: 12 } },
    },
  },
});

new Chart(document.getElementById('topicChart'), {
  type: 'bar',
  data: {
    labels: ${JSON.stringify(topicLabels)},
    datasets: [{
      label: 'Actions',
      data: ${JSON.stringify(topicValues)},
      backgroundColor: '#3fb950',
      borderRadius: 4,
    }]
  },
  options: {
    indexAxis: 'y',
    responsive: true,
    plugins: { legend: { display: false } },
    scales: {
      x: { beginAtZero: true, ticks: { stepSize: 1 } },
    },
  },
});
</script>
</body>
</html>`;
}

// ─── Server ─────────────────────────────────────────────────────────────────

function startServer(): void {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(buildHTML());
  });

  server.listen(PORT, () => {
    console.log(`PULSE Dashboard running at http://localhost:${PORT}`);
    console.log('Press Ctrl+C to stop.\n');
  });
}

// Run standalone
startServer();
