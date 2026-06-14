/**
 * Multi-page web dashboard for PULSE.
 * Serves on http://localhost:3500 — uses Node built-in http, no external deps.
 * Run: npx tsx src/analytics/web-dashboard.ts
 */

import http from 'node:http';
import { getStats } from './tracker.js';
import { getLeadStats, listLeads, getHotLeads } from '../crm/leads.js';
import { getPendingFollowUps, getRecentInteractions, completeFollowUp, skipFollowUp } from '../crm/interactions.js';
import { getROIStats, getConversionsByPlatform, getTrackedLinks } from './roi.js';
import { getWhiteLabelConfig, getAgentName, getBrandColors } from '../core/whitelabel.js';

const PORT = 3500;

// ─── Color Helpers ──────────────────────────────────────────────────────────

function css(): string {
  const c = getBrandColors();
  return `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #0d1117; color: #c9d1d9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; display: flex; min-height: 100vh; }
    a { color: ${c.primary}; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .sidebar { width: 220px; background: #010409; border-right: 1px solid #21262d; padding: 20px 0; flex-shrink: 0; }
    .sidebar h1 { color: ${c.primary}; font-size: 1.3rem; padding: 0 20px 20px; border-bottom: 1px solid #21262d; margin-bottom: 8px; }
    .sidebar a { display: block; padding: 10px 20px; color: #8b949e; font-size: 0.9rem; }
    .sidebar a:hover, .sidebar a.active { color: #f0f6fc; background: #161b22; text-decoration: none; }
    .main { flex: 1; padding: 24px; overflow-y: auto; max-width: 1200px; }
    .main h2 { color: ${c.primary}; font-size: 1.4rem; margin-bottom: 16px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; margin-bottom: 24px; }
    .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 18px; }
    .card h3 { color: #8b949e; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; }
    .card .val { font-size: 2rem; font-weight: 700; color: #f0f6fc; }
    .card .sub { color: #8b949e; font-size: 0.75rem; margin-top: 4px; }
    .charts { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 24px; }
    .chart-box { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 18px; }
    .chart-box h3 { color: ${c.primary}; font-size: 0.8rem; text-transform: uppercase; margin-bottom: 10px; }
    canvas { max-height: 260px; }
    table { width: 100%; border-collapse: collapse; background: #161b22; border: 1px solid #30363d; border-radius: 8px; overflow: hidden; }
    th { background: #0d1117; color: #8b949e; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; text-align: left; padding: 10px 14px; border-bottom: 1px solid #30363d; }
    td { padding: 10px 14px; border-bottom: 1px solid #21262d; font-size: 0.85rem; }
    tr:last-child td { border-bottom: none; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 0.75rem; font-weight: 600; }
    .badge-green { background: #238636; color: #fff; }
    .badge-yellow { background: #9e6a03; color: #fff; }
    .badge-red { background: #da3633; color: #fff; }
    .btn { display: inline-block; padding: 6px 14px; border-radius: 6px; font-size: 0.8rem; font-weight: 500; cursor: pointer; border: none; margin-right: 6px; }
    .btn-green { background: #238636; color: #fff; }
    .btn-gray { background: #30363d; color: #c9d1d9; }
    .list-item { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 14px; margin-bottom: 10px; }
    .list-item h4 { color: #f0f6fc; font-size: 0.9rem; margin-bottom: 4px; }
    .list-item p { color: #8b949e; font-size: 0.8rem; }
    @media (max-width: 768px) {
      body { flex-direction: column; }
      .sidebar { width: 100%; display: flex; overflow-x: auto; border-right: none; border-bottom: 1px solid #21262d; padding: 0; }
      .sidebar h1 { padding: 12px; border-bottom: none; margin-bottom: 0; white-space: nowrap; }
      .sidebar a { white-space: nowrap; padding: 12px 16px; }
      .charts { grid-template-columns: 1fr; }
    }
  `;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Layout ─────────────────────────────────────────────────────────────────

function layout(page: string, title: string, body: string): string {
  const name = getAgentName();
  const nav = [
    { href: '/', label: 'Dashboard' },
    { href: '/leads', label: 'Leads' },
    { href: '/roi', label: 'ROI' },
    { href: '/follow-ups', label: 'Follow-ups' },
  ];
  const links = nav.map(n =>
    `<a href="${n.href}" class="${n.href === page ? 'active' : ''}">${n.label}</a>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="60">
<title>${esc(name)} - ${esc(title)}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<style>${css()}</style>
</head>
<body>
<nav class="sidebar">
  <h1>${esc(name)}</h1>
  ${links}
</nav>
<div class="main">
  <h2>${esc(title)}</h2>
  ${body}
</div>
</body>
</html>`;
}

// ─── Dashboard Page ─────────────────────────────────────────────────────────

function dashboardPage(): string {
  const leadStats = getLeadStats();
  const roiStats = getROIStats('month');
  const recent = getRecentInteractions(10);
  const weekStats = getStats('week');

  // Interaction counts per day (last 7 days)
  const dayCounts: Record<string, number> = {};
  for (const i of getRecentInteractions(200)) {
    const day = i.createdAt.slice(0, 10);
    dayCounts[day] = (dayCounts[day] ?? 0) + 1;
  }
  const days: string[] = [];
  const dayVals: number[] = [];
  for (let d = 6; d >= 0; d--) {
    const key = new Date(Date.now() - d * 86400_000).toISOString().slice(0, 10);
    days.push(key.slice(5));
    dayVals.push(dayCounts[key] ?? 0);
  }

  // Leads by platform
  const allLeads = listLeads({ limit: 500 });
  const platCounts: Record<string, number> = {};
  for (const l of allLeads) platCounts[l.platform] = (platCounts[l.platform] ?? 0) + 1;
  const platLabels = Object.keys(platCounts);
  const platValues = Object.values(platCounts);

  const recentRows = recent.map(i => `
    <tr>
      <td>${esc(i.platform)}</td>
      <td>${esc(i.type)}</td>
      <td>${esc((i.ourContent || '').slice(0, 80))}${(i.ourContent || '').length > 80 ? '...' : ''}</td>
      <td>${i.createdAt.slice(0, 16).replace('T', ' ')}</td>
    </tr>
  `).join('');

  const body = `
    <div class="grid">
      <div class="card"><h3>Total Leads</h3><div class="val">${leadStats.total}</div></div>
      <div class="card"><h3>Hot Leads</h3><div class="val">${leadStats.hot}</div><div class="sub">score >= 60</div></div>
      <div class="card"><h3>Conversion Rate</h3><div class="val">${roiStats.conversionRate}%</div></div>
      <div class="card"><h3>Total Revenue</h3><div class="val">$${roiStats.totalRevenue.toFixed(2)}</div></div>
    </div>
    <div class="charts">
      <div class="chart-box"><h3>Interactions (7 days)</h3><canvas id="interChart"></canvas></div>
      <div class="chart-box"><h3>Leads by Platform</h3><canvas id="platChart"></canvas></div>
    </div>
    <h2 style="margin-top:8px;">Recent Interactions</h2>
    <table><thead><tr><th>Platform</th><th>Type</th><th>Content</th><th>Date</th></tr></thead>
    <tbody>${recentRows || '<tr><td colspan="4">No interactions yet.</td></tr>'}</tbody></table>
    <script>
    const cc = ['#58a6ff','#3fb950','#d29922','#f85149','#bc8cff','#79c0ff','#56d364','#e3b341'];
    Chart.defaults.color = '#8b949e'; Chart.defaults.borderColor = '#21262d';
    new Chart(document.getElementById('interChart'), {
      type: 'bar',
      data: { labels: ${JSON.stringify(days)}, datasets: [{ label: 'Interactions', data: ${JSON.stringify(dayVals)}, backgroundColor: '#58a6ff', borderRadius: 4 }] },
      options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } }
    });
    ${platLabels.length > 0 ? `new Chart(document.getElementById('platChart'), {
      type: 'doughnut',
      data: { labels: ${JSON.stringify(platLabels)}, datasets: [{ data: ${JSON.stringify(platValues)}, backgroundColor: cc.slice(0, ${platLabels.length}), borderWidth: 0 }] },
      options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
    });` : ''}
    </script>
  `;
  return layout('/', 'Dashboard', body);
}

// ─── Leads Page ─────────────────────────────────────────────────────────────

function leadsPage(): string {
  const leads = listLeads({ limit: 100, sortBy: 'score' });
  const rows = leads.map(l => {
    const badgeClass = l.score >= 60 ? 'badge-green' : l.score >= 30 ? 'badge-yellow' : 'badge-red';
    return `<tr>
      <td>${l.id}</td>
      <td>${esc(l.username)}</td>
      <td>${esc(l.platform)}</td>
      <td><span class="badge ${badgeClass}">${l.score}</span></td>
      <td>${esc(l.status)}</td>
      <td>${l.interactionCount}</td>
      <td>${l.lastInteractionAt.slice(0, 10)}</td>
    </tr>`;
  }).join('');

  const body = `
    <table><thead><tr><th>ID</th><th>Name</th><th>Platform</th><th>Score</th><th>Status</th><th>Interactions</th><th>Last Active</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="7">No leads yet.</td></tr>'}</tbody></table>
  `;
  return layout('/leads', 'Leads', body);
}

// ─── ROI Page ───────────────────────────────────────────────────────────────

function roiPage(): string {
  const stats = getROIStats('month');
  const byPlatform = getConversionsByPlatform();
  const links = getTrackedLinks(50);

  const platLabels = Object.keys(byPlatform);
  const platClicks = platLabels.map(p => byPlatform[p].clicks);
  const platConv = platLabels.map(p => byPlatform[p].conversions);

  const linkRows = links.map(l => `
    <tr>
      <td><code>${esc(l.shortCode)}</code></td>
      <td>${esc(l.originalUrl.slice(0, 60))}${l.originalUrl.length > 60 ? '...' : ''}</td>
      <td>${esc(l.platform)}</td>
      <td>${esc(l.campaign || '-')}</td>
      <td>${l.clickCount}</td>
      <td>${l.createdAt.slice(0, 10)}</td>
    </tr>
  `).join('');

  const body = `
    <div class="grid">
      <div class="card"><h3>Total Clicks</h3><div class="val">${stats.totalClicks}</div></div>
      <div class="card"><h3>Conversions</h3><div class="val">${stats.totalConversions}</div></div>
      <div class="card"><h3>Revenue</h3><div class="val">$${stats.totalRevenue.toFixed(2)}</div></div>
    </div>
    ${platLabels.length > 0 ? `
    <div class="chart-box" style="margin-bottom:24px;">
      <h3>Conversions by Platform</h3>
      <canvas id="roiChart"></canvas>
    </div>
    <script>
    Chart.defaults.color = '#8b949e'; Chart.defaults.borderColor = '#21262d';
    new Chart(document.getElementById('roiChart'), {
      type: 'bar',
      data: {
        labels: ${JSON.stringify(platLabels)},
        datasets: [
          { label: 'Clicks', data: ${JSON.stringify(platClicks)}, backgroundColor: '#58a6ff', borderRadius: 4 },
          { label: 'Conversions', data: ${JSON.stringify(platConv)}, backgroundColor: '#3fb950', borderRadius: 4 }
        ]
      },
      options: { responsive: true, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } }
    });
    </script>` : ''}
    <h2 style="margin-top:8px;">Tracked Links</h2>
    <table><thead><tr><th>Code</th><th>URL</th><th>Platform</th><th>Campaign</th><th>Clicks</th><th>Created</th></tr></thead>
    <tbody>${linkRows || '<tr><td colspan="6">No tracked links yet.</td></tr>'}</tbody></table>
  `;
  return layout('/roi', 'ROI Tracking', body);
}

// ─── Follow-ups Page ────────────────────────────────────────────────────────

function followUpsPage(): string {
  const followUps = getPendingFollowUps(50);

  const items = followUps.map(f => {
    const leadName = f.lead ? `@${esc(f.lead.username)}` : `Lead #${f.leadId}`;
    const scoreClass = (f.lead?.score ?? 0) >= 60 ? 'badge-green' : (f.lead?.score ?? 0) >= 30 ? 'badge-yellow' : 'badge-red';
    return `
      <div class="list-item">
        <h4>${leadName} <span class="badge ${scoreClass}">${f.lead?.score ?? '?'}</span> on ${esc(f.platform)}</h4>
        <p><strong>${esc(f.action)}</strong> &mdash; due ${f.dueAt.slice(0, 10)}</p>
        ${f.message ? `<p style="margin-top:6px;color:#c9d1d9;">${esc(f.message)}</p>` : ''}
        <div style="margin-top:10px;">
          <form method="POST" action="/api/follow-ups/${f.id}/complete" style="display:inline;">
            <button type="submit" class="btn btn-green">Complete</button>
          </form>
          <form method="POST" action="/api/follow-ups/${f.id}/skip" style="display:inline;">
            <button type="submit" class="btn btn-gray">Skip</button>
          </form>
        </div>
      </div>
    `;
  }).join('');

  const body = items || '<p style="color:#8b949e;">No pending follow-ups. Check back later.</p>';
  return layout('/follow-ups', 'Follow-ups', body);
}

// ─── JSON APIs ──────────────────────────────────────────────────────────────

function jsonResponse(res: http.ServerResponse, data: unknown): void {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function redirect(res: http.ServerResponse, to: string): void {
  res.writeHead(302, { Location: to });
  res.end();
}

function htmlResponse(res: http.ServerResponse, html: string): void {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

// ─── Router ─────────────────────────────────────────────────────────────────

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = req.url || '/';
  const method = req.method || 'GET';

  try {
    // POST routes for follow-up actions
    const completeMatch = url.match(/^\/api\/follow-ups\/(\d+)\/complete$/);
    if (method === 'POST' && completeMatch) {
      completeFollowUp(Number(completeMatch[1]));
      return redirect(res, '/follow-ups');
    }
    const skipMatch = url.match(/^\/api\/follow-ups\/(\d+)\/skip$/);
    if (method === 'POST' && skipMatch) {
      skipFollowUp(Number(skipMatch[1]));
      return redirect(res, '/follow-ups');
    }

    // JSON APIs
    if (url === '/api/stats') return jsonResponse(res, getStats('week'));
    if (url === '/api/leads') return jsonResponse(res, listLeads({ limit: 100 }));
    if (url === '/api/roi') return jsonResponse(res, { stats: getROIStats('month'), byPlatform: getConversionsByPlatform() });
    if (url === '/api/follow-ups') return jsonResponse(res, getPendingFollowUps(50));

    // HTML pages
    if (url === '/') return htmlResponse(res, dashboardPage());
    if (url === '/leads') return htmlResponse(res, leadsPage());
    if (url === '/roi') return htmlResponse(res, roiPage());
    if (url === '/follow-ups') return htmlResponse(res, followUpsPage());

    // 404
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  } catch (err) {
    console.error('Dashboard error:', err);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal server error');
  }
}

// ─── Server ─────────────────────────────────────────────────────────────────

export function startDashboard(): void {
  const server = http.createServer(handleRequest);
  server.listen(PORT, () => {
    const name = getAgentName();
    console.log(`${name} Dashboard running at http://localhost:${PORT}`);
    console.log('Pages: /, /leads, /roi, /follow-ups');
    console.log('Press Ctrl+C to stop.\n');
  });
}

// Run standalone
startDashboard();
