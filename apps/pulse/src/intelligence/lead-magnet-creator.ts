/**
 * Lead Magnet Generator.
 * Generates downloadable lead magnets: checklists, tip sheets, mini-guides, cheat sheets.
 * These are what people trade their email for.
 */

import { askLLM } from '../core/llm.js';
import { getConfig, getPersonaPrompt } from '../core/persona.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export type LeadMagnetType = 'checklist' | 'tips' | 'guide' | 'cheatsheet';

export interface LeadMagnet {
  title: string;
  type: LeadMagnetType;
  content: string;       // Markdown formatted content
  htmlVersion: string;   // Styled HTML (printable, dark theme)
  wordCount: number;
  sections: number;
}

// ─── Type-Specific Prompts ───────────────────────────────────────────────────

const TYPE_INSTRUCTIONS: Record<LeadMagnetType, { titleFormat: string; instruction: string; maxTokens: number }> = {
  checklist: {
    titleFormat: '10-Point [Topic] Checklist',
    instruction: `Generate a 10-point checklist. Each item should have:
- A clear action item (checkbox-style)
- A 1-2 sentence explanation of why it matters

Format as markdown with checkboxes:
- [ ] **Action item** — Explanation of why this matters and how to do it.

Include a brief intro paragraph (2-3 sentences) before the checklist.`,
    maxTokens: 2000,
  },
  tips: {
    titleFormat: '7 [Topic] Tips Most People Miss',
    instruction: `Generate 7 actionable tips that most people overlook. Each tip should have:
- A clear, specific title
- 2-3 sentences of explanation with a concrete example or number

Format as markdown with numbered headers:
## 1. Tip Title
Explanation with specific example.

Include a brief intro paragraph.`,
    maxTokens: 2000,
  },
  guide: {
    titleFormat: "The Complete Beginner's Guide to [Topic]",
    instruction: `Generate a comprehensive beginner's guide with 5-7 sections, totaling 500-800 words. Each section should have:
- A clear heading
- 2-4 paragraphs of useful, specific content
- At least one actionable takeaway

Format as markdown with ## headings. Include an intro and a conclusion/next-steps section.`,
    maxTokens: 3000,
  },
  cheatsheet: {
    titleFormat: '[Topic] Cheat Sheet',
    instruction: `Generate a quick-reference cheat sheet. Use a compact format with:
- Categorized sections (3-5 categories)
- Bullet points, short definitions, or key-value pairs
- Tables where appropriate (markdown tables)
- Bold key terms

Format as markdown. Keep descriptions to one line each. This should be scannable, not readable — a reference card, not an article.`,
    maxTokens: 2000,
  },
};

// ─── Content Generation ──────────────────────────────────────────────────────

/**
 * Generate a lead magnet of the specified type.
 * Uses persona config for topic if none specified.
 * Returns null if LLM fails.
 */
export async function generateLeadMagnet(
  type: LeadMagnetType,
  topic?: string
): Promise<LeadMagnet | null> {
  const config = getConfig();
  const personaPrompt = getPersonaPrompt();
  const p = config.persona;

  const effectiveTopic = topic || `${p.niche}${p.problemSolved ? ` — ${p.problemSolved}` : ''}`;
  const typeInfo = TYPE_INSTRUCTIONS[type];
  const titleTemplate = typeInfo.titleFormat.replace('[Topic]', effectiveTopic);

  const prompt = `${personaPrompt}

Create a lead magnet: "${titleTemplate}"

Topic: ${effectiveTopic}
Target audience: ${p.idealCustomer || 'general audience'}
Brand: ${p.brandName}

${typeInfo.instruction}

Rules:
- Be specific and actionable — no filler or generic advice
- Use real examples, numbers, or data points where possible
- Write in a helpful, authoritative tone
- Do not include any preamble like "Here's your guide:" — start directly with the content
- Start with a markdown title: # ${titleTemplate}

Content:`;

  const response = await askLLM(prompt, { maxTokens: typeInfo.maxTokens, temperature: 0.7 });
  if (!response) return null;

  let content = response.trim();

  // Ensure it starts with a title
  if (!content.startsWith('#')) {
    content = `# ${titleTemplate}\n\n${content}`;
  }

  // Extract title from first line
  const titleMatch = content.match(/^#\s+(.+)/);
  const title = titleMatch ? titleMatch[1].trim() : titleTemplate;

  // Count sections (## headings or checkbox items or numbered items)
  const sectionMatches = content.match(/^#{1,3}\s+/gm);
  const checkboxMatches = content.match(/^- \[[ x]\]/gm);
  const numberedMatches = content.match(/^##\s+\d+\./gm);
  const sections = Math.max(
    (sectionMatches?.length ?? 1) - 1, // minus the title
    checkboxMatches?.length ?? 0,
    numberedMatches?.length ?? 0,
    1
  );

  const wordCount = content.split(/\s+/).length;
  const htmlVersion = buildLeadMagnetHtml(title, content, type);

  return {
    title,
    type,
    content,
    htmlVersion,
    wordCount,
    sections,
  };
}

// ─── Generate All Types ──────────────────────────────────────────────────────

/**
 * Generate one lead magnet of each type for the brand's niche.
 */
export async function generateAllLeadMagnets(): Promise<LeadMagnet[]> {
  const types: LeadMagnetType[] = ['checklist', 'tips', 'guide', 'cheatsheet'];
  const results: LeadMagnet[] = [];

  for (let i = 0; i < types.length; i++) {
    const type = types[i];
    console.log(`  [Lead Magnet] Generating ${type} (${i + 1}/${types.length})...`);
    const magnet = await generateLeadMagnet(type);
    if (magnet) results.push(magnet);
    // Rate limit between calls
    if (i < types.length - 1) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  return results;
}

// ─── HTML Builder ────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Convert markdown lead magnet content to a styled, printable HTML page.
 */
function buildLeadMagnetHtml(title: string, markdown: string, type: LeadMagnetType): string {
  const config = getConfig();
  const brandName = escapeHtml(config.persona.brandName);
  const safeTitle = escapeHtml(title);

  // Basic markdown to HTML conversion
  let html = markdown
    // Headings
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '') // Remove title (we render it separately)
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Checkboxes
    .replace(/^- \[ \] (.+)$/gm, '<div class="check-item"><span class="checkbox">&#x2610;</span> $1</div>')
    .replace(/^- \[x\] (.+)$/gm, '<div class="check-item checked"><span class="checkbox">&#x2611;</span> $1</div>')
    // Bullet points
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    // Markdown tables (simple conversion)
    .replace(/^\|(.+)\|$/gm, (match) => {
      const cells = match.split('|').filter(c => c.trim()).map(c => c.trim());
      if (cells.every(c => /^[-:]+$/.test(c))) return ''; // separator row
      const tag = 'td';
      return `<tr>${cells.map(c => `<${tag}>${c}</${tag}>`).join('')}</tr>`;
    })
    // Paragraphs (lines that aren't already HTML)
    .split('\n')
    .map(line => {
      const trimmed = line.trim();
      if (!trimmed) return '';
      if (trimmed.startsWith('<')) return trimmed;
      return `<p>${trimmed}</p>`;
    })
    .join('\n');

  // Wrap consecutive <li> in <ul>
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');

  // Wrap consecutive <tr> in <table>
  html = html.replace(/((?:<tr>.*<\/tr>\n?)+)/g, '<table>$1</table>');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle} — ${brandName}</title>
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0a; color: #e5e5e5; line-height: 1.7;
      max-width: 750px; margin: 0 auto; padding: 3rem 2rem;
    }

    /* ─ Header ─ */
    .header {
      text-align: center; margin-bottom: 3rem;
      padding-bottom: 2rem; border-bottom: 2px solid #222;
    }
    .brand { color: #3b82f6; font-size: 0.875rem; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 1rem; }
    .header h1 { font-size: 2rem; font-weight: 800; line-height: 1.2; margin-bottom: 0.5rem; }
    .type-badge {
      display: inline-block; background: #1e293b; color: #94a3b8;
      padding: 0.25rem 0.75rem; border-radius: 999px; font-size: 0.75rem;
      text-transform: uppercase; letter-spacing: 1px;
    }

    /* ─ Content ─ */
    h2 { font-size: 1.4rem; margin: 2rem 0 1rem; color: #fff; }
    h3 { font-size: 1.15rem; margin: 1.5rem 0 0.75rem; color: #d1d5db; }
    p { margin-bottom: 1rem; }
    strong { color: #fff; }
    ul { margin: 1rem 0; padding-left: 1.5rem; }
    li { margin-bottom: 0.5rem; }

    /* ─ Checkboxes ─ */
    .check-item {
      padding: 0.75rem 1rem; margin: 0.5rem 0;
      background: #141414; border-radius: 8px;
      border-left: 3px solid #3b82f6;
    }
    .checkbox { margin-right: 0.5rem; font-size: 1.2rem; }

    /* ─ Tables ─ */
    table {
      width: 100%; border-collapse: collapse; margin: 1.5rem 0;
    }
    td, th {
      padding: 0.5rem 1rem; border: 1px solid #222; text-align: left;
    }
    tr:nth-child(odd) { background: #141414; }

    /* ─ Footer ─ */
    .footer {
      text-align: center; margin-top: 3rem; padding-top: 2rem;
      border-top: 1px solid #222; opacity: 0.5; font-size: 0.8rem;
    }

    /* ─ Print ─ */
    @media print {
      body { background: #fff; color: #111; max-width: 100%; padding: 1rem; }
      .brand { color: #2563eb; }
      h2 { color: #111; }
      h3 { color: #333; }
      strong { color: #111; }
      .check-item { background: #f5f5f5; border-left-color: #2563eb; }
      tr:nth-child(odd) { background: #f9f9f9; }
      td, th { border-color: #ddd; }
      .type-badge { background: #e5e7eb; color: #374151; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="brand">${brandName}</div>
    <h1>${safeTitle}</h1>
    <span class="type-badge">${type}</span>
  </div>

  <div class="content">
    ${html}
  </div>

  <div class="footer">
    Created with Pulse AI &mdash; ${brandName} &copy; ${new Date().getFullYear()}
  </div>
</body>
</html>`;
}
