import { Marked } from 'marked';
import type { CandidateDiff, ChangeGroup } from '../core/changes';

const START = '';
const END = '';
const POINT = '';
const INDEX_BASE = 0xe100;
const SENTINELS = /[--]/g;

const marked = new Marked({ gfm: true, breaks: false, async: false });

const ALLOWED = new Set([
  'P', 'STRONG', 'EM', 'DEL', 'S', 'CODE', 'PRE', 'A', 'UL', 'OL', 'LI', 'BLOCKQUOTE',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'BR', 'SPAN', 'DIV', 'INPUT',
]);
const SAFE_HREF = /^(https?:|mailto:|#|\/|\.{0,2}\/)/i;

export const KIND_TITLE: Record<ChangeGroup['kind'], string> = {
  added: 'Added — pop to remove it',
  altered: 'Altered — pop to keep the original wording',
  deleted: 'Deleted — pop to keep the original text',
};

/** Drop anything outside a small allowlist; raw HTML from Markdown never becomes live markup. */
function sanitize(root: HTMLElement) {
  for (const el of [...root.querySelectorAll('*')]) {
    if (!ALLOWED.has(el.tagName) || (el.tagName === 'INPUT' && el.getAttribute('type') !== 'checkbox')) {
      el.replaceWith(el.ownerDocument.createTextNode(el.tagName === 'SCRIPT' || el.tagName === 'STYLE' ? '' : el.textContent ?? ''));
      continue;
    }
    for (const attr of [...el.attributes]) {
      const keep = (el.tagName === 'A' && attr.name === 'href') || (el.tagName === 'INPUT' && ['type', 'checked'].includes(attr.name));
      if (!keep) el.removeAttribute(attr.name);
    }
    if (el.tagName === 'A') {
      const href = (el.getAttribute('href') ?? '').replace(SENTINELS, '');
      if (SAFE_HREF.test(href)) el.setAttribute('href', href);
      else el.removeAttribute('href');
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noopener noreferrer');
    }
    if (el.tagName === 'INPUT') el.setAttribute('disabled', '');
  }
}

function changeEl(doc: Document, g: ChangeGroup, text: string): HTMLElement {
  const el = doc.createElement('span');
  el.className = `cand-change ${g.kind}`;
  el.dataset.change = g.id;
  el.dataset.kind = g.kind;
  el.textContent = text;
  return el;
}

function markerEl(doc: Document, g: ChangeGroup, symbol: string, extra: string): HTMLElement {
  const el = doc.createElement('span');
  el.className = `cand-marker ${g.kind} ${extra}`;
  el.dataset.change = g.id;
  el.dataset.kind = g.kind;
  el.textContent = symbol;
  return el;
}

/**
 * Render the candidate (after pops) with every live change group wrapped in a pop target. Groups are marked
 * with private-use sentinels before Markdown rendering, so a change may cross formatting boundaries; groups
 * that end up with no visible text (e.g. a pure syntax change) get a small marker. `raw` shows the Markdown source.
 */
export function renderCandidate(diff: CandidateDiff, popped: readonly string[], raw: boolean): { root: HTMLElement; groups: ChangeGroup[] } {
  const byId = new Map(diff.groups.map((g) => [g.id, g]));
  const live: ChangeGroup[] = [];
  let text = '';
  for (const piece of diff.pieces) {
    if (piece.kind === 'same') {
      text += piece.text;
      continue;
    }
    const g = byId.get(piece.id)!;
    if (popped.includes(g.id)) {
      text += g.original;
      continue;
    }
    const index = String.fromCharCode(INDEX_BASE + live.length);
    live.push(g);
    // Deletions and whitespace-only changes (e.g. a line break) get a visible, poppable marker.
    if (g.kind === 'deleted') text += POINT + index;
    else if (!g.replacement.trim()) text += POINT + index + g.replacement;
    else text += START + index + g.replacement + END;
  }

  const doc = document.implementation.createHTMLDocument('candidate');
  const root = doc.createElement('div');
  if (raw) {
    const pre = doc.createElement('div');
    pre.className = 'cand-raw';
    pre.textContent = text;
    root.append(pre);
  } else {
    root.innerHTML = marked.parse(text) as string;
    sanitize(root);
  }

  const seen = new Set<string>();
  const withText = new Set<string>();
  let current: ChangeGroup | null = null;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  let expectIndex: 'start' | 'point' | null = null;
  for (const node of nodes) {
    const data = node.data;
    if (!/[--]/.test(data) && !current) continue;
    const frag = doc.createDocumentFragment();
    let buffer = '';
    const flush = () => {
      if (!buffer) return;
      if (current) {
        frag.append(changeEl(doc, current, buffer));
        withText.add(current.id);
      } else frag.append(doc.createTextNode(buffer));
      buffer = '';
    };
    for (const ch of data) {
      const code = ch.charCodeAt(0);
      if (expectIndex && code >= INDEX_BASE) {
        const g = live[code - INDEX_BASE];
        if (g) {
          seen.add(g.id);
          if (expectIndex === 'point')
            frag.append(g.kind === 'deleted' ? markerEl(doc, g, '', 'gap') : markerEl(doc, g, g.replacement.includes('\n') ? '↵' : '␣', 'ws'));
          else current = g;
        }
        expectIndex = null;
        continue;
      }
      if (ch === START || ch === POINT) {
        flush();
        expectIndex = ch === START ? 'start' : 'point';
        continue;
      }
      if (ch === END) {
        flush();
        if (current && !withText.has(current.id)) frag.append(markerEl(doc, current, '◆', 'format'));
        current = null;
        continue;
      }
      buffer += ch;
    }
    flush();
    node.replaceWith(frag);
  }
  root.querySelectorAll('a[href]').forEach((a) => a.setAttribute('href', (a.getAttribute('href') ?? '').replace(SENTINELS, '')));

  // Changes hidden inside attributes (e.g. a link destination) still need a visible, poppable marker.
  const unseen = live.filter((g) => !seen.has(g.id));
  if (unseen.length) {
    const p = doc.createElement('p');
    p.className = 'cand-unseen';
    p.append('Changed link or formatting: ');
    for (const g of unseen) p.append(markerEl(doc, g, '◆', 'format'));
    root.append(p);
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-change]')) {
    const g = byId.get(el.dataset.change!)!;
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('title', KIND_TITLE[g.kind]);
    el.setAttribute(
      'aria-label',
      g.kind === 'deleted'
        ? `Deleted: “${g.original.trim()}”. Pop to keep it.`
        : g.kind === 'added'
          ? `Added: “${g.replacement.trim()}”. Pop to remove it.`
          : `Altered: “${g.original.trim()}” to “${g.replacement.trim()}”. Pop to keep the original.`,
    );
  }
  return { root, groups: live };
}
