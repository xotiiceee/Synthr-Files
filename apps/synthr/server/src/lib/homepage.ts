type HomepageData = {
  publicBaseUrl: string;
  priceUsd: number;
  network: string;
  networkLabel: string;
  paymentConfigured: boolean;
  setupStatus: string;
  lastUpdated: string;
  githubUrl: string;
  statusPageUrl: string;
  contactEmail: string;
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
  const baseUrl = escapeHtml(data.publicBaseUrl);
  const price = `$${data.priceUsd.toFixed(3)}`;
  const advicePrice = `$${(data.priceUsd * 1.5).toFixed(4)}`;
  const network = escapeHtml(data.network);
  const networkLabel = escapeHtml(data.networkLabel || 'Base Sepolia testnet');
  const status = data.paymentConfigured ? 'x402 ready' : 'wallet placeholder';
  const lastUpdated = escapeHtml(data.lastUpdated);
  const githubUrl = escapeHtml(data.githubUrl);
  const statusPageUrl = escapeHtml(data.statusPageUrl);
  const contactEmail = escapeHtml(data.contactEmail);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebAPI",
    name: "Synthr Cyber",
    description:
      "x402-paid cybersecurity intelligence API for agents: dependency risk, active exploitation, secure implementation guidance, and x402 endpoint trust checks.",
    provider: {
      "@type": "Organization",
      name: "Synthr Tools",
      url: data.publicBaseUrl,
    },
    termsOfService: `${data.publicBaseUrl}/llms.txt`,
    documentation: `${data.publicBaseUrl}/openapi.json`,
  };

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Synthr Cyber — x402 security intel for agents</title>
    <meta name="description" content="x402-paid cybersecurity API for agents: stack risk, dependency audits, exploitability signals, breaking KEV, and x402 endpoint trust checks. Base Sepolia testnet, micro-USDC per call.">
    <link rel="icon" type="image/svg+xml" href="/favicon.svg">
    <link rel="shortcut icon" href="/favicon.svg">
    <script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>
    <style>
      :root {
        color-scheme: dark;
        --bg: #06080d;
        --ink: #eef5ff;
        --muted: #93a4b8;
        --dim: #66758a;
        --panel: #0d131d;
        --panel2: #101927;
        --panel3: #071018;
        --line: rgba(161, 185, 215, 0.16);
        --line2: rgba(161, 185, 215, 0.28);
        --green: #49f2a1;
        --cyan: #5fd7ff;
        --yellow: #ffcf6a;
        --pink: #ff7ab6;
        --red: #ff6969;
        --shadow: 0 24px 80px rgba(0, 0, 0, 0.38);
      }

      * { box-sizing: border-box; }

      body {
        margin: 0;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: var(--ink);
        background:
          linear-gradient(rgba(95, 215, 255, 0.045) 1px, transparent 1px),
          linear-gradient(90deg, rgba(95, 215, 255, 0.045) 1px, transparent 1px),
          radial-gradient(circle at 18% 0%, rgba(73, 242, 161, 0.12), transparent 28%),
          radial-gradient(circle at 86% 12%, rgba(95, 215, 255, 0.14), transparent 30%),
          var(--bg);
        background-size: 36px 36px, 36px 36px, auto, auto, auto;
      }

      a { color: inherit; text-decoration: none; }

      .wrap {
        width: min(1240px, calc(100% - 32px));
        margin: 0 auto;
      }

      .topbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 18px;
        padding: 18px 0 16px;
        border-bottom: 1px solid var(--line);
      }

      .brand {
        display: flex;
        align-items: center;
        gap: 12px;
        font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
        font-weight: 800;
      }

      .logo {
        display: grid;
        place-items: center;
        width: 38px;
        height: 38px;
        border: 1px solid var(--line2);
        border-radius: 8px;
        background: #09111b;
        color: var(--green);
        box-shadow: inset 0 0 24px rgba(73, 242, 161, 0.08);
      }

      .live-dot {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        padding: 4px 10px;
        border: 1px solid rgba(73, 242, 161, 0.4);
        border-radius: 999px;
        color: var(--green);
        font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
        font-size: 11px;
        font-weight: 700;
        background: rgba(73, 242, 161, 0.08);
      }
      .live-dot::before {
        content: "";
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: var(--green);
        box-shadow: 0 0 14px rgba(73, 242, 161, 0.8);
        animation: pulse 2.2s ease-in-out infinite;
      }
      @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.35 } }

      .nav {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        align-items: center;
        gap: 8px;
        color: #c7d4e5;
        font-size: 13px;
        font-weight: 700;
      }

      .nav a {
        display: inline-flex;
        align-items: center;
        min-height: 36px;
        padding: 0 12px;
        border: 1px solid transparent;
        border-radius: 8px;
        transition: background 160ms ease, border-color 160ms ease, color 160ms ease;
      }

      .nav a:hover {
        border-color: var(--line2);
        background: rgba(255, 255, 255, 0.045);
        color: var(--ink);
      }

      .nav a.nav-primary {
        border-color: rgba(73, 242, 161, 0.42);
        background: rgba(73, 242, 161, 0.11);
        color: var(--green);
      }

      .nav a.nav-primary:hover {
        background: rgba(73, 242, 161, 0.18);
        color: #b9ffd9;
      }

      .hero {
        display: grid;
        grid-template-columns: minmax(0, 0.95fr) minmax(460px, 1.05fr);
        gap: 20px;
        align-items: stretch;
        padding: 34px 0 20px;
      }

      .panel {
        min-width: 0;
        border: 1px solid var(--line);
        border-radius: 14px;
        background: rgba(13, 19, 29, 0.88);
        box-shadow: var(--shadow);
      }

      .hero-copy {
        padding: 30px;
      }

      .kicker {
        display: inline-flex;
        gap: 9px;
        align-items: center;
        color: var(--green);
        font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }

      .kicker::before {
        content: "";
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--green);
        box-shadow: 0 0 20px rgba(73, 242, 161, 0.75);
      }

      h1 {
        margin: 20px 0 0;
        font-size: clamp(42px, 6.4vw, 82px);
        line-height: 0.92;
        letter-spacing: -0.06em;
      }

      .lede {
        margin: 22px 0 0;
        color: #c7d4e5;
        font-size: 18px;
        line-height: 1.58;
        max-width: 700px;
      }

      .why-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
        margin-top: 20px;
      }

      .why {
        padding: 12px;
        border: 1px solid var(--line);
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.025);
      }
      .why strong { display: block; font-size: 13px; color: var(--ink); }
      .why span { display: block; margin-top: 4px; color: var(--muted); font-size: 12px; line-height: 1.45; }

      .statline {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
        margin-top: 24px;
      }

      .stat {
        min-width: 0;
        padding: 13px;
        border: 1px solid var(--line);
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.025);
      }

      .stat span {
        display: block;
        color: var(--dim);
        font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.07em;
      }

      .stat strong {
        display: block;
        margin-top: 7px;
        overflow-wrap: anywhere;
        color: var(--ink);
        font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
        font-size: 13px;
      }
      .stat small {
        display: block;
        margin-top: 4px;
        color: var(--dim);
        font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
        font-size: 11px;
      }

      .status-grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
        gap: 14px;
      }

      .signal-panel {
        padding: 18px;
      }

      .signal-panel h2 {
        font-size: clamp(24px, 3vw, 34px);
      }

      .status-row {
        display: grid;
        grid-template-columns: 132px 1fr;
        gap: 12px;
        align-items: center;
        padding: 13px 0;
        border-bottom: 1px solid var(--line);
      }

      .status-row:last-child { border-bottom: 0; }

      .status-label {
        color: var(--dim);
        font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.07em;
      }

      .status-value {
        min-width: 0;
        color: #dce8f8;
        font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
        font-size: 13px;
        overflow-wrap: anywhere;
      }

      .status-value.good { color: var(--green); }

      .trace {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 12px 14px;
        align-items: start;
        margin-top: 16px;
      }

      .trace-dot {
        display: grid;
        place-items: center;
        width: 28px;
        height: 28px;
        border: 1px solid rgba(73, 242, 161, 0.45);
        border-radius: 8px;
        color: var(--green);
        font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
        font-size: 12px;
        font-weight: 800;
        background: rgba(73, 242, 161, 0.08);
      }

      .trace-copy strong { display: block; font-size: 14px; }
      .trace-copy span { display: block; margin-top: 4px; color: var(--muted); font-size: 13px; line-height: 1.45; }

      .buttons {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 26px;
      }

      .btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 42px;
        padding: 0 14px;
        border: 1px solid var(--line2);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.035);
        color: #dce8f8;
        font-size: 13px;
        font-weight: 700;
      }

      .btn.primary {
        background: var(--green);
        color: #031009;
        border-color: rgba(73, 242, 161, 0.8);
      }

      .console { overflow: hidden; }

      .chrome {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        padding: 13px 16px;
        border-bottom: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.035);
      }

      .dots { display: flex; gap: 7px; }
      .dot { width: 9px; height: 9px; border-radius: 50%; }
      .dot.r { background: var(--red); }
      .dot.y { background: var(--yellow); }
      .dot.g { background: var(--green); }

      .path {
        color: var(--muted);
        font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
        font-size: 12px;
      }

      pre {
        max-width: 100%;
        margin: 0;
        padding: 18px;
        overflow-x: auto;
        overflow-y: hidden;
        background: #050910;
        color: #dce8f8;
        font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
        font-size: 12.5px;
        line-height: 1.65;
      }

      code {
        font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
        color: #dce8f8;
      }

      .green { color: var(--green); }
      .cyan { color: var(--cyan); }
      .yellow { color: var(--yellow); }
      .pink { color: var(--pink); }
      .muted { color: var(--muted); }
      .red { color: var(--red); }

      section { padding: 22px 0; }

      .section-head {
        display: flex;
        align-items: end;
        justify-content: space-between;
        gap: 24px;
        margin-bottom: 14px;
      }

      h2 {
        margin: 0;
        font-size: clamp(26px, 3.8vw, 42px);
        letter-spacing: -0.04em;
      }

      .section-head p {
        margin: 0;
        max-width: 560px;
        color: var(--muted);
        line-height: 1.55;
      }

      .endpoint-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 14px;
      }

      .endpoint {
        min-width: 0;
        display: grid;
        grid-template-columns: 1fr;
        gap: 14px;
        padding: 16px;
      }

      .endpoint.featured {
        grid-column: span 2;
        border-color: rgba(95, 215, 255, 0.32);
        box-shadow: 0 0 0 1px rgba(95, 215, 255, 0.12), var(--shadow);
      }

      .endpoint-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
      }

      .endpoint-head .why-line {
        display: block;
        margin-top: 8px;
        color: var(--cyan);
        font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
        font-size: 12px;
        letter-spacing: 0.02em;
      }

      .method {
        display: inline-flex;
        align-items: center;
        min-height: 24px;
        padding: 0 8px;
        border-radius: 6px;
        background: rgba(95, 215, 255, 0.12);
        color: var(--cyan);
        font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
        font-size: 12px;
        font-weight: 800;
      }

      .method.get {
        background: rgba(73, 242, 161, 0.12);
        color: var(--green);
      }

      .endpoint h3 {
        margin: 8px 0 0;
        font-size: 18px;
      }

      .endpoint p {
        margin: 8px 0 0;
        color: var(--muted);
        line-height: 1.55;
        font-size: 14px;
      }

      .price {
        color: var(--yellow);
        font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
        font-size: 12px;
        white-space: nowrap;
      }

      .mini-code {
        min-width: 0;
        border: 1px solid var(--line);
        border-radius: 10px;
        overflow: hidden;
      }

      .mini-code pre {
        padding: 13px;
        font-size: 12px;
      }

      .two-col {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 14px;
      }

      .three-col {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 14px;
      }

      .card {
        padding: 18px;
      }

      .card h3 {
        margin: 0 0 10px;
        font-size: 18px;
      }

      .card p,
      .card li {
        color: var(--muted);
        line-height: 1.55;
        font-size: 14px;
      }

      .card p { margin: 0; }
      .card ul { margin: 0; padding-left: 18px; }
      .card li + li { margin-top: 8px; }
      .card .pill {
        display: inline-block;
        margin-top: 8px;
        padding: 3px 9px;
        border: 1px solid var(--line2);
        border-radius: 999px;
        font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
        font-size: 11px;
        color: #c7d4e5;
      }

      .table { overflow: auto; }

      table {
        width: 100%;
        min-width: 760px;
        border-collapse: collapse;
      }

      th, td {
        padding: 14px;
        border-bottom: 1px solid var(--line);
        text-align: left;
        vertical-align: top;
        font-size: 14px;
      }

      th {
        color: var(--dim);
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }

      td { color: #cfdaea; }
      tr:last-child td { border-bottom: 0; }

      .footer {
        display: flex;
        flex-wrap: wrap;
        gap: 18px;
        justify-content: space-between;
        padding: 26px 0 48px;
        color: var(--dim);
        font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
        font-size: 12px;
      }
      .footer-links {
        display: flex;
        gap: 16px;
        flex-wrap: wrap;
      }
      .footer-links a {
        color: var(--muted);
        text-decoration: underline;
        text-underline-offset: 3px;
      }
      .footer-links a:hover { color: var(--ink); }

      .methods-block {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 14px;
      }

      .method-card {
        min-width: 0;
        padding: 18px;
      }
      .method-card h3 { margin: 0 0 8px; font-size: 16px; }
      .method-card p { margin: 0; color: var(--muted); line-height: 1.55; font-size: 14px; }
      .method-card pre {
        margin-top: 12px;
        border-radius: 10px;
        border: 1px solid var(--line);
      }

      details summary {
        cursor: pointer;
        color: var(--cyan);
        font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
        font-size: 13px;
        padding: 8px 0;
      }
      details[open] summary { margin-bottom: 6px; }

      @media (max-width: 980px) {
        .topbar { align-items: flex-start; flex-direction: column; }
        .nav { justify-content: flex-start; width: 100%; }
        .hero,
        .status-grid,
        .endpoint-grid,
        .two-col,
        .three-col,
        .methods-block {
          grid-template-columns: 1fr;
        }
        .endpoint.featured { grid-column: span 1; }
        .statline,
        .why-grid { grid-template-columns: 1fr; }
        .section-head { display: block; }
        .section-head p { margin-top: 8px; }
        body { overflow-x: hidden; }
      }
    </style>
  </head>
  <body>
    <header class="wrap topbar">
      <a class="brand" href="/">
        <span class="logo">S_</span>
        <span>SYNTHR.CYBER</span>
      </a>
      <nav class="nav" aria-label="Primary navigation">
        <span class="live-dot" title="Live x402 service">${escapeHtml(status)}</span>
        <a href="#endpoints">Endpoints</a>
        <a href="#examples">Examples</a>
        <a href="#errors">Errors</a>
        <a href="${baseUrl}/llms.txt">Agent Docs</a>
        <a href="${baseUrl}/openapi.json">OpenAPI</a>
        <a class="nav-primary" href="${baseUrl}/x402-catalog.json">Catalog JSON</a>
      </nav>
    </header>

    <main class="wrap">
      <section class="hero">
        <div class="panel hero-copy">
          <div class="kicker">paid security signals over http 402</div>
          <h1>Security intel endpoints for agents that ship code.</h1>
          <p class="lede">
            Synthr is a small x402 API surface for dependency risk, active exploitation, secure implementation guidance,
            and endpoint trust checks. Agents send compact JSON. Synthr returns sourced, machine-actionable JSON.
          </p>

          <div class="why-grid">
            <div class="why">
              <strong>EPSS-prioritized</strong>
              <span>Sort fixes by real exploitation probability, not just CVSS.</span>
            </div>
            <div class="why">
              <strong>agentSurface scoring</strong>
              <span>Flags vulns most likely to affect tool servers, auth flows, and SDK paths.</span>
            </div>
            <div class="why">
              <strong>no keys, no subscriptions</strong>
              <span>Pay per call in micro-USDC over x402. Discovery is always free.</span>
            </div>
          </div>

          <div class="statline">
            <div class="stat"><span>Base URL</span><strong>${baseUrl}</strong></div>
            <div class="stat"><span>Price floor</span><strong>${price} / request</strong><small>advice: ${advicePrice}</small></div>
            <div class="stat"><span>Network</span><strong>${networkLabel}</strong><small>${network} · micro-USDC</small></div>
          </div>

          <div class="buttons">
            <a class="btn primary" href="#examples" data-track="hero_examples">View request examples</a>
            <a class="btn" href="${baseUrl}/x402-catalog.json" data-track="hero_catalog">Machine catalog</a>
            <a class="btn" href="${baseUrl}/health" data-track="hero_health">Health check</a>
          </div>
        </div>

        <aside class="panel console">
          <div class="chrome">
            <div class="dots"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span></div>
            <div class="path">POST /v1/cyber/stack-brief</div>
          </div>
<pre><span class="muted">// one x402-paid call, structured risk brief out</span>
{
  <span class="cyan">"stack"</span>: {
    <span class="cyan">"dependencies"</span>: [
      { <span class="cyan">"name"</span>: <span class="yellow">"express"</span>, <span class="cyan">"version"</span>: <span class="yellow">"4.18.2"</span>, <span class="cyan">"ecosystem"</span>: <span class="yellow">"npm"</span> },
      { <span class="cyan">"name"</span>: <span class="yellow">"fastapi"</span>, <span class="cyan">"version"</span>: <span class="yellow">"0.110.0"</span>, <span class="cyan">"ecosystem"</span>: <span class="yellow">"pypi"</span> },
      { <span class="cyan">"name"</span>: <span class="yellow">"gin-gonic/gin"</span>, <span class="cyan">"version"</span>: <span class="yellow">"1.9.1"</span>, <span class="cyan">"ecosystem"</span>: <span class="yellow">"go"</span> }
    ]
  },
  <span class="cyan">"context"</span>: <span class="yellow">"agent harness with auth tools"</span>,
  <span class="cyan">"depth"</span>: <span class="yellow">"standard"</span>
}

<span class="green">=> prioritizedRisks[], sources[], agentActions[]</span></pre>
        </aside>
      </section>

      <section aria-label="Live API status">
        <div class="status-grid">
          <article class="panel signal-panel">
            <div class="section-head">
              <div>
                <div class="kicker">runtime trust signals</div>
                <h2>Live, priced, and machine-readable.</h2>
              </div>
            </div>
            <div class="status-row">
              <div class="status-label">Payment rail</div>
              <div class="status-value good">${escapeHtml(status)}</div>
            </div>
            <div class="status-row">
              <div class="status-label">Discovery</div>
              <div class="status-value">llms.txt + OpenAPI + x402 catalog — always free</div>
            </div>
            <div class="status-row">
              <div class="status-label">Challenge</div>
              <div class="status-value">unpaid protected calls return HTTP 402</div>
            </div>
            <div class="status-row">
              <div class="status-label">Network</div>
              <div class="status-value">${networkLabel} · ${network}</div>
            </div>
            <div class="status-row">
              <div class="status-label">Health</div>
              <div class="status-value"><code>GET ${baseUrl}/health</code> → 200, static, free</div>
            </div>
          </article>

          <article class="panel signal-panel">
            <div class="chrome">
              <div class="dots"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span></div>
              <div class="path">agent payment trace</div>
            </div>
            <div class="trace">
              <div class="trace-dot">01</div>
              <div class="trace-copy">
                <strong>Discover</strong>
                <span>Agent reads <code>/llms.txt</code>, <code>/openapi.json</code>, or <code>/x402-catalog.json</code>.</span>
              </div>
              <div class="trace-dot">02</div>
              <div class="trace-copy">
                <strong>Challenge</strong>
                <span>Protected endpoint responds with a structured x402 payment requirement.</span>
              </div>
              <div class="trace-dot">03</div>
              <div class="trace-copy">
                <strong>Execute</strong>
                <span>Paid request returns JSON fields agents can route on: risk, evidence, score, and next action.</span>
              </div>
              <div class="trace-dot">04</div>
              <div class="trace-copy">
                <strong>Settle</strong>
                <span>Response includes <code>X-PAYMENT-RESPONSE</code>; the agent records the receipt and caches the result.</span>
              </div>
            </div>
          </article>
        </div>
      </section>

      <section id="endpoints">
        <div class="section-head">
          <h2>Endpoint surface</h2>
          <p>Focused routes, predictable schemas, explicit prices. Built to be called by CI, coding agents, and x402-aware tool routers.</p>
        </div>

        <div class="endpoint-grid">
          <article class="panel endpoint featured">
            <div class="endpoint-head">
              <div>
                <span class="method">POST</span>
                <h3><code>/v1/x402/endpoint-check</code></h3>
                <p>Checks whether an x402 endpoint is documented, reachable, and likely worth paying before an agent spends. The thing other x402 builders will call.</p>
                <span class="why-line">Why it matters: trust-before-pay reduces wasted USDC and bad routing decisions.</span>
              </div>
              <span class="price">${price}</span>
            </div>
            <div class="mini-code"><pre>{
  <span class="cyan">"endpointUrl"</span>: <span class="yellow">"${baseUrl}/v1/cyber/breaking"</span>,
  <span class="cyan">"expectedMethod"</span>: <span class="yellow">"GET"</span>
}

<span class="green">=> trustScore, payabilityStatus, recommendation, evidence[]</span></pre></div>
          </article>

          <article class="panel endpoint">
            <div class="endpoint-head">
              <div>
                <span class="method">POST</span>
                <h3><code>/v1/cyber/stack-brief</code></h3>
                <p>Full stack risk summary with OSV findings, EPSS exploit probability, KEV flags, and agent-surface scoring.</p>
                <span class="why-line">Any OSV ecosystem supported: npm, pypi, go, cargo, maven, and more.</span>
              </div>
              <span class="price">${price}</span>
            </div>
            <div class="mini-code"><pre>{
  <span class="cyan">"stackSummary"</span>: { <span class="cyan">"criticalFindings"</span>: 1 },
  <span class="cyan">"prioritizedRisks"</span>: [...],
  <span class="cyan">"agentActions"</span>: [...]
}</pre></div>
          </article>

          <article class="panel endpoint">
            <div class="endpoint-head">
              <div>
                <span class="method">POST</span>
                <h3><code>/v1/cyber/audit-deps</code></h3>
                <p>Dependency audit for known vulnerabilities and malicious package signals. Useful as an install or pre-deploy gate.</p>
              </div>
              <span class="price">${price}</span>
            </div>
            <div class="mini-code"><pre>{
  <span class="cyan">"dependencies"</span>: [
    { <span class="cyan">"name"</span>: <span class="yellow">"express"</span>, <span class="cyan">"version"</span>: <span class="yellow">"4.18.2"</span>, <span class="cyan">"ecosystem"</span>: <span class="yellow">"npm"</span> }
  ],
  <span class="cyan">"includeMalicious"</span>: true
}</pre></div>
          </article>

          <article class="panel endpoint">
            <div class="endpoint-head">
              <div>
                <span class="method get">GET</span>
                <h3><code>/v1/cyber/breaking</code></h3>
                <p>Recent CISA KEV additions enriched with EPSS and short notes for agentic builders.</p>
                <span class="why-line">Why it matters: stay ahead of actively exploited CVEs without reading bulletins.</span>
              </div>
              <span class="price">${price}</span>
            </div>
            <div class="mini-code"><pre>GET ${baseUrl}/v1/cyber/breaking?days=14&amp;limit=5

<span class="green">=> cve, epss, percentile, requiredAction</span></pre></div>
          </article>
        </div>
      </section>

      <section id="examples">
        <div class="section-head">
          <h2>End-to-end paid call</h2>
          <p>A complete round trip: 402 challenge → pay → 200 + structured JSON + payment receipt. This is what an x402-aware client does internally.</p>
        </div>

        <div class="panel console">
          <div class="chrome">
            <div class="dots"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span></div>
            <div class="path">paid execution → 200 + X-PAYMENT-RESPONSE</div>
          </div>
<pre><span class="green"># 1) unpaid protected call → 402 challenge</span>
curl -i -X POST ${baseUrl}/v1/cyber/stack-brief \\
  -H <span class="yellow">"content-type: application/json"</span> \\
  --data '{ <span class="cyan">"stack"</span>: { <span class="cyan">"dependencies"</span>: [{ <span class="cyan">"name"</span>: <span class="yellow">"express"</span>, <span class="cyan">"version"</span>: <span class="yellow">"4.18.2"</span>, <span class="cyan">"ecosystem"</span>: <span class="yellow">"npm"</span> }] } }'

<span class="red">HTTP/2 402</span>
payment-required: eyJ4NDAyVmVyc2lvbiI6Mi...

<span class="green"># 2) client satisfies the requirement with a signed USDC payment header</span>
curl -X POST ${baseUrl}/v1/cyber/stack-brief \\
  -H <span class="yellow">"content-type: application/json"</span> \\
  -H <span class="yellow">"X-PAYMENT: &lt;signed x402 payment&gt;"</span> \\
  --data '{ <span class="cyan">"stack"</span>: { <span class="cyan">"dependencies"</span>: [{ <span class="cyan">"name"</span>: <span class="yellow">"express"</span>, <span class="cyan">"version"</span>: <span class="yellow">"4.18.2"</span>, <span class="cyan">"ecosystem"</span>: <span class="yellow">"npm"</span> }] } }'

<span class="green">HTTP/2 200</span>
x-payment-response: eyJyZWNlaXB0IjoiMHg...
content-type: application/json

{
  <span class="cyan">"stackSummary"</span>: { <span class="cyan">"criticalFindings"</span>: 1, <span class="cyan">"totalDeps"</span>: 1 },
  <span class="cyan">"prioritizedRisks"</span>: [
    {
      <span class="cyan">"id"</span>: <span class="yellow">"GHSA-...CVE-..."</span>,
      <span class="cyan">"package"</span>: <span class="yellow">"express"</span>,
      <span class="cyan">"patchPriority"</span>: <span class="yellow">"P0"</span>,
      <span class="cyan">"agentSurface"</span>: <span class="yellow">"high"</span>,
      <span class="cyan">"epss"</span>: 0.94,
      <span class="cyan">"kev"</span>: true,
      <span class="cyan">"fixVersion"</span>: <span class="yellow">"4.19.2"</span>,
      <span class="cyan">"recommendedAction"</span>: <span class="yellow">"block deploy; bump express"</span>
    }
  ],
  <span class="cyan">"agentActions"</span>: [ <span class="yellow">"bump express to 4.19.2"</span>, <span class="yellow">"re-run stack-brief after upgrade"</span> ],
  <span class="cyan">"sources"</span>: [<span class="yellow">"OSV"</span>, <span class="yellow">"EPSS"</span>, <span class="yellow">"CISA KEV"</span>]
}</pre>
        </div>
      </section>

      <section>
        <div class="section-head">
          <h2>Copy/paste calls</h2>
          <p>These examples show the raw API shape. Use an x402-aware fetch client for paid execution.</p>
        </div>

        <div class="two-col">
          <article class="panel console">
            <div class="chrome">
              <div class="dots"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span></div>
              <div class="path">unpaid discovery</div>
            </div>
<pre><span class="green"># service health</span>
curl ${baseUrl}/health

<span class="green"># agent instructions</span>
curl ${baseUrl}/llms.txt

<span class="green"># endpoint catalog</span>
curl ${baseUrl}/x402-catalog.json

<span class="green"># OpenAPI spec</span>
curl ${baseUrl}/openapi.json</pre>
          </article>

          <article class="panel console">
            <div class="chrome">
              <div class="dots"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span></div>
              <div class="path">402 challenge preview</div>
            </div>
<pre>curl -i -X POST ${baseUrl}/v1/x402/endpoint-check \\
  -H <span class="yellow">"content-type: application/json"</span> \\
  --data '{
    <span class="cyan">"endpointUrl"</span>: <span class="yellow">"${baseUrl}/v1/cyber/breaking"</span>,
    <span class="cyan">"expectedMethod"</span>: <span class="yellow">"GET"</span>
  }'

<span class="green">HTTP/2 402</span>
payment-required: eyJ4NDAyVmVyc2lvbiI6Mi...</pre>
          </article>
        </div>
      </section>

      <section>
        <div class="section-head">
          <h2>Response fields agents can route on</h2>
          <p>No prose-only output. Responses are designed for branching decisions in harnesses and CI.</p>
        </div>

        <div class="panel table">
          <table>
            <thead>
              <tr>
                <th>Field</th>
                <th>Where it appears</th>
                <th>How to use it</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code>patchPriority</code></td>
                <td><code>stack-brief</code></td>
                <td>Route P0/P1 findings into blocking deploy checks or urgent dependency updates.</td>
              </tr>
              <tr>
                <td><code>agentSurface</code></td>
                <td><code>stack-brief</code>, <code>breaking</code></td>
                <td>Prioritize vulnerabilities likely to affect tool servers, auth flows, APIs, LLM SDKs, and data access paths. <a href="#agent-surface" style="color:var(--cyan);text-decoration:underline">How it's scored →</a></td>
              </tr>
              <tr>
                <td><code>epss</code> / <code>kev</code></td>
                <td>security endpoints</td>
                <td>Use real-world exploitation likelihood and known active exploitation as sorting signals.</td>
              </tr>
              <tr>
                <td><code>payabilityStatus</code></td>
                <td><code>endpoint-check</code></td>
                <td>Decide whether an autonomous agent should call, avoid, retry, or request human review before paying.</td>
              </tr>
              <tr>
                <td><code>sources[]</code></td>
                <td>all major responses</td>
                <td>Show provenance, store evidence, or let a human inspect the records behind the recommendation.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section id="agent-surface">
        <div class="section-head">
          <h2>How <code>agentSurface</code> is scored</h2>
          <p>Plain OSV wrappers stop at "is there a CVE." Synthr goes one step further.</p>
        </div>
        <article class="panel card">
          <p>
            For each finding we collect the affected package metadata, the calling <code>context</code> field submitted
            with the request (e.g. "agent harness with auth tools"), and structured signals from OSV descriptions
            (auth, RCE, prototype pollution, request smuggling, path traversal, SSRF). We then flag findings most
            likely to land on an agentic attack surface: tool servers with public endpoints, auth flows, JSON/HTTP
            SDK boundaries, file access, and command-execution paths.
          </p>
          <p style="margin-top:10px;">
            The result is a coarse <code>low / medium / high / critical</code> surface score — not a CVSS replacement,
            but a router signal: <em>is this likely to bite <strong>this agent</strong> specifically?</em>
          </p>
          <span class="pill">low / medium / high / critical</span>
        </article>
      </section>

      <section id="errors">
        <div class="section-head">
          <h2>Error & retry contract</h2>
          <p>Failure shapes agents can branch on. All error bodies are JSON, not HTML.</p>
        </div>

        <div class="methods-block">
          <article class="panel method-card">
            <h3>HTTP 402 — Payment Required</h3>
            <p>Protected endpoint hit without a valid <code>X-PAYMENT</code> header. Body is a structured x402 payment requirement describing the price, network, and payee. Reattempt after satisfying the requirement.</p>
<pre><span class="red">402</span> Payment Required
payment-required: eyJ4NDAy...
{ <span class="cyan">"error"</span>: <span class="yellow">"payment_required"</span>, <span class="cyan">"price"</span>: <span class="yellow">"$0.005"</span> }</pre>
          </article>

          <article class="panel method-card">
            <h3>HTTP 429 — Rate Limited</h3>
            <p>Too many calls against <code>/v1/*</code> within the window. Body includes <code>retryAfterMs</code>. Back off linearly and retry; the call is not charged.</p>
<pre><span class="red">429</span> Too Many Requests
{ <span class="cyan">"error"</span>: <span class="yellow">"rate_limited"</span>, <span class="cyan">"retryAfterMs"</span>: 1500 }</pre>
          </article>

          <article class="panel method-card">
            <h3>HTTP 400 — Bad Request</h3>
            <p>Malformed JSON, missing required <code>stack</code> or <code>dependencies</code>, or unsupported ecosystem. No payment is taken for failed validation.</p>
<pre><span class="red">400</span> Bad Request
{ <span class="cyan">"error"</span>: <span class="yellow">"invalid_stack"</span>, <span class="cyan">"message"</span>: <span class="yellow">"dependencies[] is required"</span> }</pre>
          </article>

          <article class="panel method-card">
            <h3>HTTP 5xx — Server Error</h3>
            <p>Upstream OSV/EPSS timeouts or internal failures. <strong>Retries on 5xx are free</strong> — the failed response includes no receipt. Retry with the same payment or wait for an upstream recovery.</p>
<pre><span class="red">503</span> Upstream Unavailable
{ <span class="cyan">"error"</span>: <span class="yellow">"upstream_unavailable"</span>, <span class="cyan">"upstream"</span>: <span class="yellow">"OSV"</span> }</pre>
          </article>
        </div>
      </section>

      <section>
        <div class="section-head">
          <h2>Pricing & fairness</h2>
          <p>Transparent, low-friction, worth every micro-payment.</p>
        </div>
        <div class="three-col">
          <article class="panel card">
            <h3>Discovery tier</h3>
            <p><code>/health</code>, <code>/llms.txt</code>, <code>/openapi.json</code>, <code>/x402-catalog.json</code>, and <code>/meta.json</code> are always free and unauthenticated — agents can scout before bringing a wallet.</p>
          </article>
          <article class="panel card">
            <h3>Per-call pricing</h3>
            <p>Base price <code>${price}</code> per request. <code>/v1/cyber/advice</code> is <code>${advicePrice}</code> due to deeper synthesis. No tiers, no commitments.</p>
          </article>
          <article class="panel card">
            <h3>Failure policy</h3>
            <p>4xx due to malformed input: not charged. 5xx and upstream timeouts: not charged, safe to retry. Only successful 2xx responses settle USDC.</p>
          </article>
        </div>
      </section>

      <section>
        <div class="section-head">
          <h2>Trust artifacts</h2>
          <p>Everything important is machine-readable and stable enough for agents to cache.</p>
        </div>
        <div class="two-col">
          <article class="panel card">
            <h3>Machine-readable docs</h3>
            <ul>
              <li><a href="${baseUrl}/llms.txt" data-track="trust_llms"><code>${baseUrl}/llms.txt</code></a></li>
              <li><a href="${baseUrl}/x402-catalog.json" data-track="trust_catalog"><code>${baseUrl}/x402-catalog.json</code></a></li>
              <li><a href="${baseUrl}/openapi.json" data-track="trust_openapi"><code>${baseUrl}/openapi.json</code></a></li>
              <li><a href="${baseUrl}/meta.json" data-track="trust_meta"><code>${baseUrl}/meta.json</code></a></li>
            </ul>
          </article>

          <article class="panel card">
            <h3>Runtime status</h3>
            <ul>
              <li><strong>Status:</strong> <code>${escapeHtml(status)}</code></li>
              <li><strong>Network:</strong> <code>${networkLabel}</code> · <code>${network}</code></li>
              <li><strong>Base price:</strong> <code>${price}</code></li>
              <li><strong>Advice price:</strong> <code>${advicePrice}</code></li>
              <li><strong>Last updated:</strong> <code>${lastUpdated}</code></li>
            </ul>
          </article>
        </div>
      </section>

      <footer class="footer">
        <span>SYNTHR.CYBER // OSV + EPSS + CISA KEV + x402 endpoint trust</span>
        <span class="footer-links">
          <a href="${baseUrl}">${baseUrl}</a>
          ${githubUrl ? `<a href="${githubUrl}" data-track="footer_github">GitHub</a>` : ''}
          ${statusPageUrl ? `<a href="${statusPageUrl}" data-track="footer_status">Status</a>` : ''}
          ${contactEmail ? `<a href="mailto:${contactEmail}" data-track="footer_contact">Contact</a>` : ''}
        </span>
      </footer>
    </main>
    <script>
      (() => {
        const endpoint = '/meta.json';
        document.addEventListener('click', (event) => {
          const link = event.target.closest('a[data-track]');
          if (!link) return;

          const params = new URLSearchParams({
            track: 'homepage-click',
            target: link.dataset.track,
            href: link.href,
          });

          fetch(endpoint + '?' + params.toString(), {
            method: 'GET',
            keepalive: true,
            cache: 'no-store',
          }).catch(() => {});
        }, { capture: true });
      })();
    </script>
  </body>
</html>`;
}
