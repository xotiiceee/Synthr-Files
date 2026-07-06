type HomepageData = {
  publicBaseUrl: string;
  priceUsd: number;
  network: string;
  paymentConfigured: boolean;
  setupStatus: string;
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderHomepage(data: HomepageData) {
  const statusTone = data.paymentConfigured ? 'ready' : 'setup';
  const statusLabel = data.paymentConfigured
    ? 'Ready for payment testing'
    : 'Live, payment wallet still placeholder';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Synthr Cyber</title>
    <style>
      :root {
        --bg: #f7f3ea;
        --panel: rgba(255, 252, 245, 0.92);
        --ink: #1d1b17;
        --muted: #6a6257;
        --line: rgba(29, 27, 23, 0.12);
        --accent: #c24d2c;
        --accent-2: #1f5c52;
        --ready: #1f5c52;
        --setup: #9a3d22;
        --shadow: 0 24px 80px rgba(73, 52, 27, 0.14);
      }

      * { box-sizing: border-box; }

      body {
        margin: 0;
        font-family: Georgia, "Times New Roman", serif;
        color: var(--ink);
        background:
          radial-gradient(circle at top left, rgba(194, 77, 44, 0.16), transparent 30%),
          radial-gradient(circle at top right, rgba(31, 92, 82, 0.14), transparent 26%),
          linear-gradient(180deg, #fbf7ef 0%, var(--bg) 100%);
      }

      a {
        color: inherit;
        text-decoration: none;
      }

      .shell {
        max-width: 1120px;
        margin: 0 auto;
        padding: 32px 20px 64px;
      }

      .hero {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 28px;
        box-shadow: var(--shadow);
        overflow: hidden;
      }

      .hero-top {
        display: grid;
        gap: 28px;
        grid-template-columns: 1.5fr 0.95fr;
        padding: 32px;
      }

      .eyebrow {
        display: inline-block;
        margin-bottom: 14px;
        padding: 6px 10px;
        border-radius: 999px;
        background: rgba(194, 77, 44, 0.1);
        color: var(--accent);
        font-size: 12px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }

      h1 {
        margin: 0 0 14px;
        font-size: clamp(42px, 6vw, 74px);
        line-height: 0.95;
        letter-spacing: -0.04em;
      }

      .lede {
        max-width: 760px;
        margin: 0;
        color: var(--muted);
        font-size: 19px;
        line-height: 1.55;
      }

      .button-row {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-top: 26px;
      }

      .button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 46px;
        padding: 0 18px;
        border-radius: 999px;
        border: 1px solid transparent;
        font-size: 15px;
      }

      .button.primary {
        background: var(--ink);
        color: #fffdf8;
      }

      .button.secondary {
        background: transparent;
        border-color: var(--line);
        color: var(--ink);
      }

      .status-card {
        align-self: start;
        background: linear-gradient(180deg, rgba(255,255,255,0.94), rgba(248,243,235,0.94));
        border: 1px solid var(--line);
        border-radius: 22px;
        padding: 22px;
      }

      .status-pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 6px 10px;
        border-radius: 999px;
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: ${statusTone === 'ready' ? 'var(--ready)' : 'var(--setup)'};
        background: ${statusTone === 'ready' ? 'rgba(31, 92, 82, 0.12)' : 'rgba(154, 61, 34, 0.12)'};
      }

      .status-pill::before {
        content: "";
        width: 8px;
        height: 8px;
        border-radius: 999px;
        background: currentColor;
      }

      .status-title {
        margin: 16px 0 10px;
        font-size: 26px;
        line-height: 1.05;
      }

      .status-copy, .meta-list {
        margin: 0;
        color: var(--muted);
        font-size: 15px;
        line-height: 1.55;
      }

      .meta-list {
        margin-top: 16px;
        padding: 0;
        list-style: none;
      }

      .meta-list li + li {
        margin-top: 8px;
      }

      .grid {
        display: grid;
        gap: 18px;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        padding: 0 32px 32px;
      }

      .card {
        background: rgba(255,255,255,0.75);
        border: 1px solid var(--line);
        border-radius: 22px;
        padding: 20px;
      }

      .card h2 {
        margin: 0 0 10px;
        font-size: 22px;
      }

      .card p, .card ul {
        margin: 0;
        color: var(--muted);
        font-size: 15px;
        line-height: 1.55;
      }

      .card ul {
        padding-left: 18px;
      }

      .card li + li {
        margin-top: 8px;
      }

      .foot {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: 12px;
        margin-top: 18px;
        color: var(--muted);
        font-size: 13px;
      }

      code {
        font-family: "SFMono-Regular", Consolas, monospace;
        font-size: 0.92em;
      }

      @media (max-width: 920px) {
        .hero-top,
        .grid {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <section class="hero">
        <div class="hero-top">
          <div>
            <span class="eyebrow">x402 Cyber Intelligence</span>
            <h1>Synthr Cyber</h1>
            <p class="lede">
              Grounded, pay-per-call cybersecurity intelligence for agent builders and autonomous software workflows.
              Real OSV.dev, EPSS, and CISA KEV signals. Structured outputs. Tiny prices. No dashboard bloat.
            </p>
            <div class="button-row">
              <a class="button primary" href="${escapeHtml(data.publicBaseUrl)}/llms.txt">Agent Instructions</a>
              <a class="button secondary" href="${escapeHtml(data.publicBaseUrl)}/openapi.json">OpenAPI</a>
              <a class="button secondary" href="${escapeHtml(data.publicBaseUrl)}/x402-catalog.json">x402 Catalog</a>
              <a class="button secondary" href="${escapeHtml(data.publicBaseUrl)}/meta.json">API Metadata</a>
            </div>
          </div>
          <aside class="status-card">
            <div class="status-pill">${escapeHtml(statusLabel)}</div>
            <h2 class="status-title">Built for agents that need defensible answers.</h2>
            <p class="status-copy">
              Synthr returns machine-friendly security results with sources, exploitability context, and action cues instead of generic prose.
            </p>
            <ul class="meta-list">
              <li><strong>Price:</strong> $${data.priceUsd.toFixed(3)} per call</li>
              <li><strong>Network:</strong> <code>${escapeHtml(data.network)}</code></li>
              <li><strong>Status:</strong> <code>${escapeHtml(data.setupStatus)}</code></li>
            </ul>
          </aside>
        </div>

        <div class="grid">
          <article class="card">
            <h2>Core Endpoints</h2>
            <ul>
              <li><code>POST /v1/cyber/stack-brief</code></li>
              <li><code>POST /v1/cyber/audit-deps</code></li>
              <li><code>POST /v1/cyber/advice</code></li>
              <li><code>POST /v1/cyber/vulns</code></li>
              <li><code>GET /v1/cyber/breaking</code></li>
            </ul>
          </article>

          <article class="card">
            <h2>What Makes It Useful</h2>
            <ul>
              <li>OSV vulnerability retrieval with EPSS and KEV enrichment</li>
              <li><code>agentSurface</code> scoring for harness-relevant risk</li>
              <li>Structured JSON for CI, agents, and tool calling</li>
              <li>Discovery files for x402scan and agent ingestion</li>
            </ul>
          </article>

          <article class="card">
            <h2>Quick Links</h2>
            <ul>
              <li><a href="${escapeHtml(data.publicBaseUrl)}/health">Health Check</a></li>
              <li><a href="${escapeHtml(data.publicBaseUrl)}/llms.txt">LLM Instructions</a></li>
              <li><a href="${escapeHtml(data.publicBaseUrl)}/x402-catalog.json">Catalog JSON</a></li>
              <li><a href="${escapeHtml(data.publicBaseUrl)}/openapi.json">OpenAPI Spec</a></li>
            </ul>
          </article>
        </div>
      </section>

      <div class="foot">
        <span>Informational only. Verify all advice in your own environment.</span>
        <span>${escapeHtml(data.publicBaseUrl)}</span>
      </div>
    </main>
  </body>
</html>`;
}
