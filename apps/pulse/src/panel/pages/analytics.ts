/**
 * Analytics page — charts and insights for PULSE panel.
 *
 * Shows activity charts (Chart.js via CDN), category/platform/sentiment breakdowns,
 * top insights from the learning engine, and weekly digest generation.
 */

import { getActions, type ActionRecord } from '../../core/state.js';
import { getInsights, generateWeeklyDigest } from '../../intelligence/learning-engine.js';
import { getAutopostStats } from '../../modes/autopost.js';
import { getMentionStats } from '../../intelligence/mention-detector.js';

// ─── HTML Escaping ───────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Group actions by day key (YYYY-MM-DD) */
function groupByDay(actions: ActionRecord[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const a of actions) {
    const day = a.timestamp.slice(0, 10);
    counts[day] = (counts[day] ?? 0) + 1;
  }
  return counts;
}

/** Build labels + values for the last N days */
function last7Days(dayCounts: Record<string, number>): { labels: string[]; values: number[] } {
  const labels: string[] = [];
  const values: number[] = [];
  for (let d = 6; d >= 0; d--) {
    const key = new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);
    labels.push(key.slice(5)); // "MM-DD"
    values.push(dayCounts[key] ?? 0);
  }
  return { labels, values };
}

/** Chart.js color palette */
const COLORS = [
  '#58a6ff', '#3fb950', '#d29922', '#f85149',
  '#bc8cff', '#79c0ff', '#56d364', '#e3b341',
  '#ff7b72', '#a5d6ff', '#7ee787', '#ffa657',
];

// ─── Page CSS (scoped to analytics) ──────────────────────────────────────────

function pageCss(): string {
  return `
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 14px;
      margin-bottom: 24px;
    }

    .charts-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
      margin-bottom: 24px;
    }

    .chart-box {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 18px;
    }

    .chart-box h3 {
      color: #58a6ff;
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 12px;
    }

    canvas { max-height: 260px; }

    .insights-section {
      margin-bottom: 24px;
    }

    .insights-section h3 {
      color: #58a6ff;
      font-size: 0.95rem;
      margin-bottom: 12px;
      border-bottom: 1px solid #21262d;
      padding-bottom: 8px;
    }

    .insight-group {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 12px;
    }

    .insight-group h4 {
      color: #e6edf3;
      font-size: 0.85rem;
      margin-bottom: 8px;
    }

    .insight-group ul {
      list-style: none;
      padding: 0;
      margin: 0;
    }

    .insight-group li {
      color: #8b949e;
      font-size: 0.8rem;
      padding: 4px 0;
      border-bottom: 1px solid #21262d;
    }

    .insight-group li:last-child { border-bottom: none; }

    .insight-group li .score {
      float: right;
      color: #58a6ff;
      font-weight: 600;
    }

    .weight-bar {
      display: inline-block;
      height: 6px;
      border-radius: 3px;
      background: #58a6ff;
      margin-left: 8px;
      vertical-align: middle;
    }

    .digest-box {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 18px;
      margin-bottom: 24px;
    }

    .digest-box h3 {
      color: #58a6ff;
      font-size: 0.95rem;
      margin-bottom: 12px;
    }

    .digest-box .rec {
      color: #8b949e;
      font-size: 0.8rem;
      padding: 6px 0;
      border-bottom: 1px solid #21262d;
    }

    .digest-box .rec:last-child { border-bottom: none; }

    .no-data {
      color: #484f58;
      font-size: 0.85rem;
      font-style: italic;
    }

    @media (max-width: 768px) {
      .stats-grid { grid-template-columns: 1fr 1fr; }
      .charts-grid { grid-template-columns: 1fr; }
    }
  `;
}

// ─── renderPage ──────────────────────────────────────────────────────────────

export async function renderPage(query?: URLSearchParams): Promise<string> {
  // Gather data
  const autoStats = getAutopostStats();
  const mentionStats = getMentionStats();
  const insights = getInsights();
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const actions = getActions(sevenDaysAgo);
  const allActions = getActions();

  // Activity chart data (last 7 days)
  const dayCounts = groupByDay(actions);
  const { labels: dayLabels, values: dayValues } = last7Days(dayCounts);

  // Category breakdown (from autopost stats)
  const catLabels = Object.keys(autoStats.byCategory);
  const catValues = Object.values(autoStats.byCategory);

  // Platform breakdown (from autopost stats)
  const platLabels = Object.keys(autoStats.byPlatform);
  const platValues = Object.values(autoStats.byPlatform);

  // Sentiment breakdown (from mention stats)
  const sentLabels = Object.keys(mentionStats.bySentiment);
  const sentValues = Object.values(mentionStats.bySentiment);

  // Check for digest request
  const showDigest = query?.get('digest') === '1';
  let digestHtml = '';
  if (showDigest) {
    try {
      const digest = await generateWeeklyDigest();
      const recsHtml = digest.recommendations.length > 0
        ? digest.recommendations.map(r => `<div class="rec">${esc(r)}</div>`).join('')
        : '<div class="no-data">No recommendations generated.</div>';

      digestHtml = `
        <div class="digest-box">
          <h3>Weekly Digest (${esc(digest.period.start)} to ${esc(digest.period.end)})</h3>
          <div class="stats-grid" style="margin-bottom:14px;">
            <div class="card"><h3>Posts This Week</h3><div class="val">${digest.totalPosts}</div></div>
            <div class="card"><h3>Avg Engagement</h3><div class="val">${digest.avgEngagement}</div></div>
            <div class="card"><h3>Top Post Score</h3><div class="val">${digest.topPost ? digest.topPost.engagementScore : '-'}</div></div>
            <div class="card"><h3>Period</h3><div class="val" style="font-size:0.9rem;">${esc(digest.period.start)}<br>${esc(digest.period.end)}</div></div>
          </div>
          ${digest.topPost ? `
            <div class="insight-group">
              <h4>Top Performing Post</h4>
              <ul>
                <li>${esc(digest.topPost.content.slice(0, 200))}${digest.topPost.content.length > 200 ? '...' : ''}</li>
                <li>Platform: ${esc(digest.topPost.platform)} | Category: ${esc(digest.topPost.category)} | Score: ${digest.topPost.engagementScore}</li>
              </ul>
            </div>
          ` : ''}
          <h4 style="color:#e6edf3;margin-bottom:8px;font-size:0.85rem;">Recommendations</h4>
          ${recsHtml}
        </div>
      `;
    } catch (err) {
      digestHtml = `
        <div class="digest-box">
          <h3>Weekly Digest</h3>
          <div class="no-data">Failed to generate digest: ${esc(err instanceof Error ? err.message : String(err))}</div>
        </div>
      `;
    }
  }

  // Build insights HTML
  const topCatsHtml = insights.topCategories.length > 0
    ? insights.topCategories.slice(0, 10).map(c =>
        `<li>${esc(c.category)} (${c.count} posts) <span class="score">${c.avgScore}</span></li>`
      ).join('')
    : '<li class="no-data">Not enough data yet</li>';

  const topFormatsHtml = insights.topFormats.length > 0
    ? insights.topFormats.slice(0, 10).map(f =>
        `<li>${esc(f.format)} (${f.count} posts) <span class="score">${f.avgScore}</span></li>`
      ).join('')
    : '<li class="no-data">Not enough data yet</li>';

  const bestHoursHtml = insights.bestHours.length > 0
    ? insights.bestHours.slice(0, 8).map(h =>
        `<li>${String(h.hour).padStart(2, '0')}:00 UTC (${h.count} posts) <span class="score">${h.avgScore}</span></li>`
      ).join('')
    : '<li class="no-data">Not enough data yet</li>';

  const worstHtml = insights.worstPerformers.length > 0
    ? insights.worstPerformers.map(w =>
        `<li>${esc(w)}</li>`
      ).join('')
    : '<li class="no-data">No underperformers detected</li>';

  const driftHtml = insights.voiceDriftNotes.length > 0
    ? insights.voiceDriftNotes.map(n =>
        `<li>${esc(n)}</li>`
      ).join('')
    : '<li class="no-data">No significant drift detected</li>';

  const weightsEntries = Object.entries(insights.recommendedWeights);
  const weightsHtml = weightsEntries.length > 0
    ? weightsEntries
        .sort((a, b) => b[1] - a[1])
        .map(([cat, w]) => {
          const barWidth = Math.round(w * 200);
          return `<li>${esc(cat)} <span class="score">${(w * 100).toFixed(0)}%</span><span class="weight-bar" style="width:${barWidth}px;"></span></li>`;
        }).join('')
    : '<li class="no-data">Not enough data yet</li>';

  // Prepare chart data for embedding
  const chartData = {
    dayLabels,
    dayValues,
    catLabels,
    catValues,
    platLabels,
    platValues,
    sentLabels,
    sentValues,
  };

  return `
    <style>${pageCss()}</style>

    <!-- Top stat cards -->
    <div class="stats-grid">
      <div class="card">
        <h3>Total Posts</h3>
        <div class="val">${autoStats.totalPosts}</div>
        <div class="sub">${autoStats.todayCount} today</div>
      </div>
      <div class="card">
        <h3>Total Mentions</h3>
        <div class="val">${mentionStats.total}</div>
        <div class="sub">avg ${mentionStats.avgResponseTimeMinutes}m response</div>
      </div>
      <div class="card">
        <h3>Avg Voice Score</h3>
        <div class="val">${autoStats.avgVoiceScore.toFixed(1)}</div>
        <div class="sub">across all posts</div>
      </div>
      <div class="card">
        <h3>Total Actions</h3>
        <div class="val">${allActions.length}</div>
        <div class="sub">${actions.length} in last 7 days</div>
      </div>
    </div>

    <!-- Charts -->
    <div class="charts-grid">
      <div class="chart-box">
        <h3>Activity (Last 7 Days)</h3>
        <canvas id="activityChart"></canvas>
      </div>
      <div class="chart-box">
        <h3>Posts by Category</h3>
        ${catLabels.length > 0
          ? '<canvas id="categoryChart"></canvas>'
          : '<div class="no-data" style="padding:40px 0;text-align:center;">No category data yet</div>'
        }
      </div>
      <div class="chart-box">
        <h3>Posts by Platform</h3>
        ${platLabels.length > 0
          ? '<canvas id="platformChart"></canvas>'
          : '<div class="no-data" style="padding:40px 0;text-align:center;">No platform data yet</div>'
        }
      </div>
      <div class="chart-box">
        <h3>Mention Sentiments</h3>
        ${sentLabels.length > 0
          ? '<canvas id="sentimentChart"></canvas>'
          : '<div class="no-data" style="padding:40px 0;text-align:center;">No mention data yet</div>'
        }
      </div>
    </div>

    <!-- Insights -->
    <div class="insights-section">
      <h3>Insights</h3>
      <div class="charts-grid">
        <div class="insight-group">
          <h4>Top Categories</h4>
          <ul>${topCatsHtml}</ul>
        </div>
        <div class="insight-group">
          <h4>Top Formats</h4>
          <ul>${topFormatsHtml}</ul>
        </div>
        <div class="insight-group">
          <h4>Best Posting Hours (UTC)</h4>
          <ul>${bestHoursHtml}</ul>
        </div>
        <div class="insight-group">
          <h4>Recommended Category Weights</h4>
          <ul>${weightsHtml}</ul>
        </div>
        <div class="insight-group">
          <h4>Underperformers</h4>
          <ul>${worstHtml}</ul>
        </div>
        <div class="insight-group">
          <h4>Voice Drift Notes</h4>
          <ul>${driftHtml}</ul>
        </div>
      </div>
    </div>

    <!-- Weekly Digest -->
    <div class="insights-section">
      <h3>Weekly Digest</h3>
      ${showDigest
        ? digestHtml
        : `<div class="digest-box">
            <p style="color:#8b949e;font-size:0.85rem;margin-bottom:12px;">
              Generate an LLM-powered weekly summary with actionable recommendations based on engagement data.
            </p>
            <a href="/analytics?digest=1" class="btn btn-primary" style="text-decoration:none;">Generate Weekly Digest</a>
          </div>`
      }
    </div>

    <!-- Chart.js -->
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <script>
      (function() {
        var data = JSON.parse('${JSON.stringify(chartData).replace(/'/g, "\\'").replace(/<\//g, '<\\/')}');

        Chart.defaults.color = '#8b949e';
        Chart.defaults.borderColor = '#30363d';

        var colors = ${JSON.stringify(COLORS)};

        // Activity bar chart (last 7 days)
        new Chart(document.getElementById('activityChart'), {
          type: 'bar',
          data: {
            labels: data.dayLabels,
            datasets: [{
              label: 'Actions',
              data: data.dayValues,
              backgroundColor: '#58a6ff',
              borderRadius: 4
            }]
          },
          options: {
            responsive: true,
            plugins: { legend: { display: false } },
            scales: {
              y: { beginAtZero: true, ticks: { stepSize: 1 } }
            }
          }
        });

        // Category doughnut chart
        if (data.catLabels.length > 0) {
          new Chart(document.getElementById('categoryChart'), {
            type: 'doughnut',
            data: {
              labels: data.catLabels,
              datasets: [{
                data: data.catValues,
                backgroundColor: colors.slice(0, data.catLabels.length),
                borderWidth: 0
              }]
            },
            options: {
              responsive: true,
              plugins: {
                legend: { position: 'bottom', labels: { boxWidth: 12, padding: 10 } }
              }
            }
          });
        }

        // Platform horizontal bar chart
        if (data.platLabels.length > 0) {
          new Chart(document.getElementById('platformChart'), {
            type: 'bar',
            data: {
              labels: data.platLabels,
              datasets: [{
                label: 'Posts',
                data: data.platValues,
                backgroundColor: colors.slice(0, data.platLabels.length),
                borderRadius: 4
              }]
            },
            options: {
              indexAxis: 'y',
              responsive: true,
              plugins: { legend: { display: false } },
              scales: {
                x: { beginAtZero: true, ticks: { stepSize: 1 } }
              }
            }
          });
        }

        // Sentiment doughnut chart
        if (data.sentLabels.length > 0) {
          var sentColors = {
            'positive': '#3fb950',
            'neutral':  '#8b949e',
            'negative': '#f85149',
            'question': '#58a6ff',
            'spam':     '#484f58'
          };
          var sentBg = data.sentLabels.map(function(l) {
            return sentColors[l] || '#8b949e';
          });

          new Chart(document.getElementById('sentimentChart'), {
            type: 'doughnut',
            data: {
              labels: data.sentLabels,
              datasets: [{
                data: data.sentValues,
                backgroundColor: sentBg,
                borderWidth: 0
              }]
            },
            options: {
              responsive: true,
              plugins: {
                legend: { position: 'bottom', labels: { boxWidth: 12, padding: 10 } }
              }
            }
          });
        }
      })();
    </script>
  `;
}

// ─── handlePost ──────────────────────────────────────────────────────────────

export async function handlePost(
  action: string,
  body: Record<string, string>,
): Promise<{ redirect?: string }> {
  // The digest generation is handled via GET param (?digest=1)
  // so there's no POST action needed currently. Future actions
  // like exporting data or resetting stats could go here.
  return { redirect: '/analytics' };
}
