/**
 * Knowledge / Notes page — lets users create notes that inform the AI's content generation.
 * Each note is a piece of knowledge the bot uses when creating posts/replies.
 */

import crypto from 'node:crypto';
import { loadState, saveState } from '../../core/state.js';

// ─── Types ──────────────────────────────────────────────────────────────────

interface KnowledgeNote {
  id: string;
  title: string;
  content: string;
  tags: string[];
  priority: number; // 0=low, 1=normal, 2=high, 3=always include
  createdAt: string;
  updatedAt: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function tip(text: string): string {
  return `<span class="info-tip" role="img" aria-label="Help"><span class="info-icon">?</span><span class="tip-text">${esc(text)}</span></span>`;
}

function getNotes(): KnowledgeNote[] {
  return loadState<KnowledgeNote[]>('knowledge-notes', []);
}

function setNotes(notes: KnowledgeNote[]): void {
  saveState('knowledge-notes', notes);
}

function sortedNotes(notes: KnowledgeNote[]): KnowledgeNote[] {
  return [...notes].sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
}

// ─── CSS ────────────────────────────────────────────────────────────────────

function knowledgeCss(): string {
  return `
    .info-tip {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: transparent;
      border: 1.5px solid #6e7681;
      color: #6e7681;
      cursor: help;
      margin-left: 5px;
      position: relative;
      vertical-align: middle;
      flex-shrink: 0;
      transition: all 0.15s ease;
    }
    .info-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 700;
      line-height: 1;
      width: 100%;
      height: 100%;
    }
    .info-tip:hover { background: #58a6ff; border-color: #58a6ff; color: #fff; }
    .info-tip .tip-text {
      display: none;
      position: absolute;
      bottom: calc(100% + 6px);
      left: 50%;
      transform: translateX(-50%);
      background: #1c2128;
      border: 1px solid #444c56;
      color: #c9d1d9;
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 400;
      white-space: normal;
      width: 220px;
      line-height: 1.4;
      z-index: 100;
      text-transform: none;
      letter-spacing: normal;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    }
    .info-tip .tip-text::after {
      content: '';
      position: absolute;
      top: 100%;
      left: 50%;
      transform: translateX(-50%);
      border: 5px solid transparent;
      border-top-color: #444c56;
    }
    .info-tip:hover .tip-text { display: block; }

    .settings-card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 20px;
    }

    .settings-card h2 {
      font-size: 0.95rem;
      font-weight: 600;
      color: #58a6ff;
      margin-bottom: 16px;
      padding-bottom: 8px;
      border-bottom: 1px solid #21262d;
    }

    .form-field {
      margin-bottom: 16px;
    }

    .form-field label {
      display: block;
      color: #8b949e;
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      margin-bottom: 6px;
    }

    .form-field input[type="text"],
    .form-field textarea {
      width: 100%;
      background: #0d1117;
      color: #e6edf3;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 8px 12px;
      font-size: 0.85rem;
      font-family: inherit;
      outline: none;
      box-sizing: border-box;
    }

    .form-field input:focus,
    .form-field textarea:focus {
      border-color: #58a6ff;
    }

    .form-field textarea {
      resize: vertical;
      min-height: 100px;
    }

    .radio-group {
      display: flex;
      gap: 20px;
      align-items: center;
    }

    .radio-group label {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: #e6edf3;
      font-size: 0.85rem;
      text-transform: none;
      letter-spacing: normal;
      cursor: pointer;
    }

    .radio-group input[type="radio"] {
      margin-right: 2px;
    }

    .btn-save {
      background: #238636;
      color: #fff;
      border: 1px solid #238636;
      border-radius: 6px;
      padding: 10px 28px;
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s;
    }

    .btn-save:hover { background: #2ea043; }

    .btn-secondary {
      background: #21262d;
      color: #c9d1d9;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 8px 16px;
      font-size: 0.82rem;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s;
    }

    .btn-secondary:hover { background: #30363d; }

    .btn-danger {
      background: transparent;
      color: #f85149;
      border: 1px solid #f85149;
      border-radius: 6px;
      padding: 8px 16px;
      font-size: 0.82rem;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s;
    }

    .btn-danger:hover { background: rgba(248,81,73,0.15); }

    .note-count {
      color: #8b949e;
      font-size: 0.85rem;
      margin-bottom: 16px;
    }

    .note-card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 16px 20px;
      margin-bottom: 12px;
      transition: border-color 0.15s;
    }

    .note-card:hover { border-color: #484f58; }

    .note-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }

    .note-title {
      color: #e6edf3;
      font-size: 0.92rem;
      font-weight: 600;
      cursor: pointer;
      transition: color 0.15s;
      text-decoration: none;
    }

    .note-title:hover { color: #58a6ff; }

    .note-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }

    .note-date {
      color: #6e7681;
      font-size: 0.75rem;
    }

    .priority-badge {
      background: #d29922;
      color: #0d1117;
      font-size: 0.7rem;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 10px;
      white-space: nowrap;
    }

    .tag-list {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 8px;
    }

    .tag-pill {
      background: #21262d;
      color: #8b949e;
      font-size: 0.72rem;
      padding: 2px 10px;
      border-radius: 10px;
      white-space: nowrap;
    }

    .note-content {
      color: #c9d1d9;
      font-size: 0.84rem;
      line-height: 1.55;
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid #21262d;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .note-actions {
      display: flex;
      gap: 8px;
      margin-top: 12px;
    }

    .edit-form {
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid #21262d;
    }

    .empty-state {
      text-align: center;
      color: #6e7681;
      font-size: 0.88rem;
      line-height: 1.6;
      padding: 48px 20px;
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
    }

    .success-banner {
      background: #238636;
      color: #fff;
      padding: 10px 16px;
      border-radius: 6px;
      margin-bottom: 16px;
      font-size: 0.85rem;
    }

    .error-banner {
      background: #da3633;
      color: #fff;
      padding: 10px 16px;
      border-radius: 6px;
      margin-bottom: 16px;
      font-size: 0.85rem;
    }
  `;
}

// ─── Render Components ──────────────────────────────────────────────────────

function renderAddForm(): string {
  return `
    <div class="settings-card">
      <h2>+ Add Knowledge Note</h2>
      <form method="POST" action="/knowledge">
        <input type="hidden" name="action" value="add-note" />
        <div class="form-field">
          <label>Title ${tip('A short name for this note — e.g. "Product Features", "Brand Voice"')}</label>
          <input type="text" name="title" placeholder="e.g. Our pricing tiers" required />
        </div>
        <div class="form-field">
          <label>Content ${tip('The knowledge the AI will reference when generating content. Be specific.')}</label>
          <textarea name="content" rows="4" placeholder="Write the knowledge the AI should know about..." required></textarea>
        </div>
        <div class="form-field">
          <label>Tags ${tip('Comma-separated tags to organize notes — e.g. "product, pricing, features"')}</label>
          <input type="text" name="tags" placeholder="product, pricing, features" />
        </div>
        <div class="form-field">
          <label>Priority ${tip('Low = background context. Normal = included when relevant. High = included in most prompts. Always = injected into every LLM call.')}</label>
          <div class="radio-group">
            <label><input type="radio" name="priority" value="0" /> Low</label>
            <label><input type="radio" name="priority" value="1" checked /> Normal</label>
            <label><input type="radio" name="priority" value="2" /> High</label>
            <label><input type="radio" name="priority" value="3" /> Always</label>
          </div>
        </div>
        <button type="submit" class="btn-save">Save Note</button>
      </form>
    </div>
  `;
}

function renderNoteCard(note: KnowledgeNote, editId: string | null): string {
  const isEditing = editId === note.id;
  const isExpanded = isEditing || editId === `view_${note.id}`;
  const tags = note.tags.filter((t) => t.trim());

  let tagHtml = '';
  if (tags.length > 0) {
    tagHtml = `<div class="tag-list">${tags.map((t) => `<span class="tag-pill">${esc(t)}</span>`).join('')}</div>`;
  }

  const priorityLabels: Record<number, { label: string; color: string }> = {
    0: { label: '', color: '' },
    1: { label: 'Normal', color: '#8b949e' },
    2: { label: 'High', color: '#d29922' },
    3: { label: 'Always included', color: '#f85149' },
  };
  const pri = priorityLabels[note.priority] ?? priorityLabels[1];
  const priorityHtml = note.priority >= 2
    ? `<span class="priority-badge" style="background:${pri.color}">${pri.label}</span>`
    : '';

  const toggleParam = isExpanded ? '' : `view_${note.id}`;
  const toggleLink = toggleParam ? `/knowledge?edit=${encodeURIComponent(toggleParam)}` : '/knowledge';

  let bodyHtml = '';

  if (isEditing) {
    bodyHtml = `
      <div class="edit-form">
        <form method="POST" action="/knowledge">
          <input type="hidden" name="action" value="update-note" />
          <input type="hidden" name="noteId" value="${esc(note.id)}" />
          <div class="form-field">
            <label>Title</label>
            <input type="text" name="title" value="${esc(note.title)}" required />
          </div>
          <div class="form-field">
            <label>Content</label>
            <textarea name="content" rows="6" required>${esc(note.content)}</textarea>
          </div>
          <div class="form-field">
            <label>Tags</label>
            <input type="text" name="tags" value="${esc(tags.join(', '))}" />
          </div>
          <div class="form-field">
            <label>Priority</label>
            <div class="radio-group">
              <label><input type="radio" name="priority" value="0" ${note.priority === 0 ? 'checked' : ''} /> Low</label>
              <label><input type="radio" name="priority" value="1" ${note.priority === 1 ? 'checked' : ''} /> Normal</label>
              <label><input type="radio" name="priority" value="2" ${note.priority === 2 ? 'checked' : ''} /> High</label>
              <label><input type="radio" name="priority" value="3" ${note.priority === 3 ? 'checked' : ''} /> Always</label>
            </div>
          </div>
          <div class="note-actions">
            <button type="submit" class="btn-save" style="padding:8px 20px; font-size:0.82rem;">Save</button>
            <a href="/knowledge" class="btn-secondary" style="text-decoration:none; display:inline-flex; align-items:center;">Cancel</a>
          </div>
        </form>
        <form method="POST" action="/knowledge" style="margin-top: 8px;">
          <input type="hidden" name="action" value="delete-note" />
          <input type="hidden" name="noteId" value="${esc(note.id)}" />
          <button type="submit" class="btn-danger" onclick="if(typeof pulseConfirm==='function'){event.preventDefault();var f=this.closest('form');pulseConfirm('Delete Note','This knowledge note will be permanently removed.').then(function(ok){if(ok)f.submit();});return false;}return confirm('Delete this note?')">Delete Note</button>
        </form>
      </div>
    `;
  } else if (isExpanded) {
    bodyHtml = `
      <div class="note-content">${esc(note.content)}</div>
      <div class="note-actions">
        <a href="/knowledge?edit=${encodeURIComponent(note.id)}" class="btn-secondary" style="text-decoration:none; display:inline-flex; align-items:center;">Edit</a>
      </div>
    `;
  }

  return `
    <div class="note-card">
      <div class="note-header">
        <a href="${toggleLink}" class="note-title">${esc(note.title)}</a>
        <div class="note-meta">
          ${priorityHtml}
          <span class="note-date">${formatDate(note.updatedAt)}</span>
        </div>
      </div>
      ${tagHtml}
      ${bodyHtml}
    </div>
  `;
}

// ─── Page ───────────────────────────────────────────────────────────────────

export async function renderPage(query?: URLSearchParams): Promise<string> {
  const notes = sortedNotes(getNotes());
  const editId = query?.get('edit') || null;
  const saved = query?.get('saved');
  const error = query?.get('error');

  let banner = '';
  if (saved === '1') {
    banner = '<div class="success-banner">Note saved successfully.</div>';
  } else if (saved === 'deleted') {
    banner = '<div class="success-banner">Note deleted.</div>';
  }
  if (error === 'not-found') {
    banner = '<div class="error-banner">Note not found.</div>';
  } else if (error === 'missing-fields') {
    banner = '<div class="error-banner">Title and content are required.</div>';
  }

  const countText = notes.length === 1 ? '1 note' : `${notes.length} notes`;

  let listHtml: string;
  if (notes.length === 0) {
    listHtml = `
      <div class="empty-state">
        No knowledge notes yet. Add notes about your products, services, competitors,
        and messaging guidelines. The AI uses these when generating content.
      </div>
    `;
  } else {
    listHtml = notes.map((n) => renderNoteCard(n, editId)).join('');
  }

  return `
    <style>${knowledgeCss()}</style>
    ${banner}
    ${renderAddForm()}
    <div class="note-count">${countText}</div>
    ${listHtml}
  `;
}

// ─── Actions ────────────────────────────────────────────────────────────────

export async function handlePost(
  action: string,
  body: Record<string, string>,
): Promise<{ redirect?: string; json?: unknown }> {
  const notes = getNotes();

  if (action === 'add-note') {
    const title = (body.title || '').trim();
    const content = (body.content || '').trim();
    if (!title || !content) {
      return { redirect: '/knowledge?error=missing-fields' };
    }
    const tags = (body.tags || '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    const priority = body.priority === '1' ? 1 : 0;
    const now = new Date().toISOString();

    const note: KnowledgeNote = {
      id: 'note_' + crypto.randomUUID(),
      title,
      content,
      tags,
      priority,
      createdAt: now,
      updatedAt: now,
    };

    notes.push(note);
    setNotes(notes);
    return { redirect: '/knowledge?saved=1' };
  }

  if (action === 'update-note') {
    const noteId = (body.noteId || '').trim();
    const idx = notes.findIndex((n) => n.id === noteId);
    if (idx === -1) {
      return { redirect: '/knowledge?error=not-found' };
    }
    const title = (body.title || '').trim();
    const content = (body.content || '').trim();
    if (!title || !content) {
      return { redirect: `/knowledge?edit=${encodeURIComponent(noteId)}&error=missing-fields` };
    }
    const tags = (body.tags || '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    const priority = body.priority === '1' ? 1 : 0;

    notes[idx] = {
      ...notes[idx],
      title,
      content,
      tags,
      priority,
      updatedAt: new Date().toISOString(),
    };
    setNotes(notes);
    return { redirect: '/knowledge?saved=1' };
  }

  if (action === 'delete-note') {
    const noteId = (body.noteId || '').trim();
    const idx = notes.findIndex((n) => n.id === noteId);
    if (idx === -1) {
      return { redirect: '/knowledge?error=not-found' };
    }
    notes.splice(idx, 1);
    setNotes(notes);
    return { redirect: '/knowledge?saved=deleted' };
  }

  return { redirect: '/knowledge' };
}
