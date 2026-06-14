/**
 * Landing Page Generator.
 * Generates a complete, deployable HTML landing page from the persona config.
 * One LLM call for content, injected into a hardcoded responsive HTML template.
 */

import { askLLM } from '../core/llm.js';
import { getConfig, getPersonaPrompt } from '../core/persona.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LandingPageContent {
  headline: string;
  subheadline: string;
  ctaText: string;
  painPoints: Array<{ title: string; description: string }>;
  features: Array<{ title: string; description: string; icon: string }>;
  testimonialPlaceholder: string;
  footerText: string;
}

// ─── Content Generation ──────────────────────────────────────────────────────

/**
 * Generate landing page content using LLM + persona config.
 * Returns null if LLM fails.
 */
export async function generateLandingPageContent(): Promise<LandingPageContent | null> {
  const config = getConfig();
  const personaPrompt = getPersonaPrompt();
  const p = config.persona;

  const prompt = `${personaPrompt}

Generate landing page copy for ${p.brandName}. The page sells: ${p.problemSolved || p.niche}.
Target customer: ${p.idealCustomer || 'general audience'}.
Unique value: ${p.uniqueValue || p.tagline || 'quality service'}.

Return ONLY valid JSON (no markdown fences):
{
  "headline": "Short, punchy headline (max 10 words)",
  "subheadline": "One sentence expanding on the headline (max 25 words)",
  "ctaText": "Button text (2-4 words, action-oriented)",
  "painPoints": [
    {"title": "Pain point 1 title (3-5 words)", "description": "One sentence explaining the pain"},
    {"title": "Pain point 2 title", "description": "One sentence"},
    {"title": "Pain point 3 title", "description": "One sentence"}
  ],
  "features": [
    {"title": "Feature 1 (3-5 words)", "description": "One sentence benefit", "icon": "unicode emoji"},
    {"title": "Feature 2", "description": "One sentence benefit", "icon": "unicode emoji"},
    {"title": "Feature 3", "description": "One sentence benefit", "icon": "unicode emoji"},
    {"title": "Feature 4", "description": "One sentence benefit", "icon": "unicode emoji"}
  ],
  "testimonialPlaceholder": "Trusted by X+ [type of customer]",
  "footerText": "Short footer tagline"
}

Rules:
- Be specific to the brand, not generic marketing
- Headline should be benefit-driven, not feature-driven
- Pain points should be real problems the customer feels
- Features should describe outcomes, not implementation
- Use relevant unicode icons (not generic ones like stars)

JSON:`;

  const response = await askLLM(prompt, { maxTokens: 1500, temperature: 0.7 });
  if (!response) return null;

  try {
    let jsonStr = response.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) jsonStr = fenceMatch[1].trim();
    const objMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (objMatch) jsonStr = objMatch[0];
    const content = JSON.parse(jsonStr) as LandingPageContent;
    if (!content.headline || !content.painPoints || !content.features) {
      throw new Error('missing required fields');
    }
    return content;
  } catch (err) {
    console.log(`  [Landing] Failed to parse LLM response: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// ─── HTML Template ───────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Build a complete, self-contained HTML landing page from generated content.
 */
export function buildHtmlPage(
  content: LandingPageContent,
  options?: { style?: 'minimal' | 'bold' | 'professional'; includeEmail?: boolean }
): string {
  const config = getConfig();
  const p = config.persona;
  const style = options?.style ?? 'minimal';
  const includeEmail = options?.includeEmail ?? true;

  const brandName = escapeHtml(p.brandName);
  const headline = escapeHtml(content.headline);
  const subheadline = escapeHtml(content.subheadline);
  const ctaText = escapeHtml(content.ctaText);
  const testimonial = escapeHtml(content.testimonialPlaceholder);
  const footerText = escapeHtml(content.footerText);

  // Style-specific CSS variables
  const styleVars: Record<string, { bg: string; accent: string; text: string; cardBg: string; radius: string; heroSize: string }> = {
    minimal: {
      bg: '#0a0a0a', accent: '#3b82f6', text: '#e5e5e5', cardBg: '#141414',
      radius: '8px', heroSize: '3rem',
    },
    bold: {
      bg: '#0c0015', accent: '#a855f7', text: '#f0e6ff', cardBg: '#1a0a2e',
      radius: '12px', heroSize: '3.5rem',
    },
    professional: {
      bg: '#0f1117', accent: '#10b981', text: '#d1d5db', cardBg: '#1a1d27',
      radius: '6px', heroSize: '2.75rem',
    },
  };

  const v = styleVars[style] || styleVars.minimal;

  const painPointsHtml = content.painPoints
    .map(
      (pp) => `
        <div class="pain-card">
          <h3>${escapeHtml(pp.title)}</h3>
          <p>${escapeHtml(pp.description)}</p>
        </div>`
    )
    .join('\n');

  const featuresHtml = content.features
    .map(
      (f) => `
        <div class="feature-card">
          <div class="feature-icon">${f.icon}</div>
          <h3>${escapeHtml(f.title)}</h3>
          <p>${escapeHtml(f.description)}</p>
        </div>`
    )
    .join('\n');

  const emailFormHtml = includeEmail
    ? `
      <form class="email-form" onsubmit="event.preventDefault(); alert('Thanks! We\\'ll be in touch.');">
        <input type="email" placeholder="Enter your email" required />
        <button type="submit">${ctaText}</button>
      </form>`
    : `<a href="#" class="cta-button">${ctaText}</a>`;

  const ctaSectionForm = includeEmail
    ? `
      <form class="email-form" onsubmit="event.preventDefault(); alert('Thanks! We\\'ll be in touch.');">
        <input type="email" placeholder="Enter your email" required />
        <button type="submit">${ctaText}</button>
      </form>`
    : `<a href="#" class="cta-button">${ctaText}</a>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${brandName} — ${headline}</title>
  <style>
    :root {
      --bg: ${v.bg};
      --accent: ${v.accent};
      --text: ${v.text};
      --card-bg: ${v.cardBg};
      --radius: ${v.radius};
      --hero-size: ${v.heroSize};
    }
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
    }
    a { color: var(--accent); text-decoration: none; }

    /* ─ Nav ─ */
    nav {
      display: flex; justify-content: space-between; align-items: center;
      max-width: 1100px; margin: 0 auto; padding: 1.5rem 2rem;
    }
    .brand { font-size: 1.25rem; font-weight: 700; color: var(--accent); }

    /* ─ Hero ─ */
    .hero {
      text-align: center; padding: 6rem 2rem 4rem;
      max-width: 800px; margin: 0 auto;
    }
    .hero h1 {
      font-size: var(--hero-size); font-weight: 800;
      line-height: 1.15; margin-bottom: 1rem;
      background: linear-gradient(135deg, #fff, var(--accent));
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .hero p { font-size: 1.25rem; opacity: 0.8; margin-bottom: 2rem; }
    .email-form { display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap; }
    .email-form input {
      padding: 0.75rem 1.25rem; border-radius: var(--radius);
      border: 1px solid rgba(255,255,255,0.15); background: var(--card-bg);
      color: var(--text); font-size: 1rem; min-width: 260px;
    }
    .email-form button, .cta-button {
      padding: 0.75rem 2rem; border-radius: var(--radius);
      background: var(--accent); color: #fff; font-size: 1rem;
      font-weight: 600; border: none; cursor: pointer;
      transition: opacity 0.2s;
      display: inline-block; text-align: center;
    }
    .email-form button:hover, .cta-button:hover { opacity: 0.85; }

    /* ─ Section base ─ */
    section { max-width: 1100px; margin: 0 auto; padding: 5rem 2rem; }
    section h2 {
      font-size: 2rem; font-weight: 700; text-align: center; margin-bottom: 3rem;
    }

    /* ─ Pain Points ─ */
    .pain-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.5rem; }
    .pain-card {
      background: var(--card-bg); border-radius: var(--radius); padding: 2rem;
      border: 1px solid rgba(255,255,255,0.06);
    }
    .pain-card h3 { color: var(--accent); margin-bottom: 0.5rem; font-size: 1.1rem; }

    /* ─ Features ─ */
    .feature-grid {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 1.5rem;
    }
    .feature-card {
      background: var(--card-bg); border-radius: var(--radius); padding: 2rem;
      border: 1px solid rgba(255,255,255,0.06); text-align: center;
    }
    .feature-icon { font-size: 2.5rem; margin-bottom: 1rem; }
    .feature-card h3 { margin-bottom: 0.5rem; font-size: 1.1rem; }

    /* ─ Social Proof ─ */
    .social-proof {
      text-align: center; padding: 3rem 2rem;
      opacity: 0.7; font-size: 1.1rem; font-style: italic;
    }

    /* ─ CTA Section ─ */
    .cta-section {
      text-align: center; padding: 5rem 2rem;
      background: var(--card-bg); border-radius: var(--radius);
      max-width: 800px; margin: 0 auto 4rem;
    }
    .cta-section h2 { margin-bottom: 1rem; }
    .cta-section p { margin-bottom: 2rem; opacity: 0.8; }

    /* ─ Footer ─ */
    footer {
      text-align: center; padding: 2rem;
      opacity: 0.5; font-size: 0.875rem;
      border-top: 1px solid rgba(255,255,255,0.06);
    }

    /* ─ Responsive ─ */
    @media (max-width: 600px) {
      .hero h1 { font-size: 2rem; }
      .hero p { font-size: 1rem; }
      .email-form { flex-direction: column; align-items: center; }
      .email-form input { min-width: 100%; }
      section { padding: 3rem 1.5rem; }
    }
  </style>
</head>
<body>
  <nav>
    <div class="brand">${brandName}</div>
  </nav>

  <div class="hero">
    <h1>${headline}</h1>
    <p>${subheadline}</p>
    ${emailFormHtml}
  </div>

  <section>
    <h2>Sound Familiar?</h2>
    <div class="pain-grid">
      ${painPointsHtml}
    </div>
  </section>

  <section>
    <h2>How We Solve It</h2>
    <div class="feature-grid">
      ${featuresHtml}
    </div>
  </section>

  <div class="social-proof">${testimonial}</div>

  <div class="cta-section">
    <h2>Ready to Get Started?</h2>
    <p>${footerText}</p>
    ${ctaSectionForm}
  </div>

  <footer>
    &copy; ${new Date().getFullYear()} ${brandName}. All rights reserved.
  </footer>
</body>
</html>`;
}

// ─── Main Entry Point ────────────────────────────────────────────────────────

/**
 * Generate a complete, deployable HTML landing page.
 * Returns the full HTML string, ready to save to a file.
 */
export async function generateLandingPage(
  options?: { style?: 'minimal' | 'bold' | 'professional'; includeEmail?: boolean }
): Promise<string | null> {
  console.log('  [Landing] Generating page content...');
  const content = await generateLandingPageContent();
  if (!content) return null;

  console.log(`  [Landing] Headline: "${content.headline}"`);
  console.log(`  [Landing] Building HTML (${options?.style ?? 'minimal'} style)...`);

  return buildHtmlPage(content, options);
}
