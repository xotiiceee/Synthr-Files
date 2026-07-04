/**
 * Onboarding wizard for new hosted Pulse tenants.
 * Steps: 1. Brand identity → 2. X API keys → 3. Done
 */

import { type Tenant } from '../db.js';
import { initTenantConfig, hasTenantXKeys, storeTenantXKeys } from '../tenant.js';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderOnboarding(tenant: Tenant, step: number = 1): string {
  const steps = [
    { num: 1, label: 'Brand', done: !!tenant.name },
    { num: 2, label: 'X Account', done: hasTenantXKeys(tenant.id) },
    { num: 3, label: 'Ready', done: false },
  ];

  const progressHtml = steps
    .map(
      (s) => `
    <div style="flex:1;text-align:center;">
      <div style="width:32px;height:32px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;
        background:${s.done ? '#238636' : s.num === step ? '#58a6ff' : '#30363d'};
        color:${s.done || s.num === step ? '#fff' : '#8b949e'};font-weight:600;font-size:0.85rem;">
        ${s.done ? '&#10003;' : s.num}
      </div>
      <div style="color:${s.num === step ? '#e6edf3' : '#8b949e'};font-size:0.78rem;margin-top:4px;">${s.label}</div>
    </div>`,
    )
    .join('<div style="flex:0;width:40px;height:1px;background:#30363d;align-self:center;"></div>');

  let content = '';

  if (step === 1) {
    content = `
      <h2 style="margin-bottom:4px;">Tell us about your brand</h2>
      <p style="color:#8b949e;margin-bottom:20px;">This shapes how your marketing agent writes and what conversations it joins.</p>
      <form method="POST" action="/onboarding">
        <input type="hidden" name="step" value="1">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div><label style="display:block;color:#c9d1d9;font-size:0.82rem;margin-bottom:4px;">Brand Name *</label><input type="text" name="brandName" required placeholder="e.g., Acme Tools" style="width:100%;padding:8px 12px;background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:6px;"></div>
          <div><label style="display:block;color:#c9d1d9;font-size:0.82rem;margin-bottom:4px;">Website</label><input type="text" name="website" placeholder="https://acme.tools" style="width:100%;padding:8px 12px;background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:6px;"></div>
          <div><label style="display:block;color:#c9d1d9;font-size:0.82rem;margin-bottom:4px;">Niche</label><input type="text" name="niche" placeholder="e.g., Developer tools" style="width:100%;padding:8px 12px;background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:6px;"></div>
          <div><label style="display:block;color:#c9d1d9;font-size:0.82rem;margin-bottom:4px;">X Handle</label><input type="text" name="xHandle" placeholder="@acmetools" style="width:100%;padding:8px 12px;background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:6px;"></div>
          <div style="grid-column:1/-1;"><label style="display:block;color:#c9d1d9;font-size:0.82rem;margin-bottom:4px;">What does your agent do? (2-3 sentences)</label>
            <textarea name="agentRole" rows="3" placeholder="You're the voice of Acme Tools on X — you find developers discussing build tooling and join conversations with genuine insights..." style="width:100%;padding:8px 12px;background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:6px;resize:vertical;"></textarea>
          </div>
        </div>
        <button type="submit" style="margin-top:16px;padding:10px 24px;background:#238636;color:#fff;border:none;border-radius:6px;font-size:0.9rem;cursor:pointer;">Continue &rarr;</button>
      </form>
    `;
  } else if (step === 2) {
    content = `
      <h2 style="margin-bottom:4px;">Connect your X account</h2>
      <p style="color:#8b949e;margin-bottom:20px;">Your agent needs X API access to post and reply. <a href="https://developer.x.com" target="_blank" style="color:#58a6ff;">Get keys at developer.x.com</a></p>
      <form method="POST" action="/onboarding">
        <input type="hidden" name="step" value="2">
        <div style="display:grid;gap:12px;">
          <div><label style="display:block;color:#c9d1d9;font-size:0.82rem;margin-bottom:4px;">API Key</label><input type="password" name="apiKey" required placeholder="Paste your API Key" style="width:100%;padding:8px 12px;background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:6px;"></div>
          <div><label style="display:block;color:#c9d1d9;font-size:0.82rem;margin-bottom:4px;">API Secret</label><input type="password" name="apiSecret" required placeholder="Paste your API Secret" style="width:100%;padding:8px 12px;background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:6px;"></div>
          <div><label style="display:block;color:#c9d1d9;font-size:0.82rem;margin-bottom:4px;">Access Token</label><input type="password" name="accessToken" required placeholder="Paste your Access Token" style="width:100%;padding:8px 12px;background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:6px;"></div>
          <div><label style="display:block;color:#c9d1d9;font-size:0.82rem;margin-bottom:4px;">Access Token Secret</label><input type="password" name="accessTokenSecret" required placeholder="Paste your Access Token Secret" style="width:100%;padding:8px 12px;background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:6px;"></div>
        </div>
        <p style="color:#8b949e;font-size:0.78rem;margin-top:12px;">Keys are encrypted with AES-256-GCM before storage. We never see or log your keys.</p>
        <div style="display:flex;gap:8px;margin-top:16px;">
          <button type="submit" style="padding:10px 24px;background:#238636;color:#fff;border:none;border-radius:6px;font-size:0.9rem;cursor:pointer;">Save &amp; Continue &rarr;</button>
          <a href="/onboarding?step=3" style="padding:10px 24px;background:#21262d;color:#e6edf3;border:1px solid #30363d;border-radius:6px;font-size:0.9rem;text-decoration:none;cursor:pointer;">Skip for now</a>
        </div>
      </form>
    `;
  } else {
    content = `
      <h2 style="margin-bottom:4px;">You're all set!</h2>
      <p style="color:#8b949e;margin-bottom:20px;">Your marketing agent is ready. Chat with it to fine-tune your voice, topics, and content strategy.</p>
      <a href="/chat-setup" style="display:inline-block;padding:12px 24px;background:#238636;color:#fff;border-radius:6px;font-size:0.9rem;text-decoration:none;">Start Chatting &rarr;</a>
      <p style="color:#8b949e;margin-top:20px;font-size:0.82rem;">Pulse actions are metered through your account plan and usage entitlements.</p>
    `;
  }

  return `
    <div style="max-width:600px;margin:0 auto;">
      <div style="display:flex;align-items:center;gap:0;margin-bottom:32px;padding:20px 0;">${progressHtml}</div>
      <div style="background:#161b22;border:1px solid #30363d;border-radius:8px;padding:24px;">${content}</div>
    </div>
  `;
}

export async function handleOnboardingPost(
  tenant: Tenant,
  body: Record<string, string>,
): Promise<{ redirect: string }> {
  const step = parseInt(body.step || '1', 10);

  if (step === 1) {
    initTenantConfig(tenant.id, {
      brandName: body.brandName || '',
      website: body.website || '',
      niche: body.niche || '',
      xHandle: body.xHandle || '',
      agentRole: body.agentRole || '',
    });
    return { redirect: '/onboarding?step=2' };
  }

  if (step === 2) {
    storeTenantXKeys(tenant.id, {
      apiKey: body.apiKey || '',
      apiSecret: body.apiSecret || '',
      accessToken: body.accessToken || '',
      accessTokenSecret: body.accessTokenSecret || '',
    });
    return { redirect: '/onboarding?step=3' };
  }

  return { redirect: '/create' };
}
