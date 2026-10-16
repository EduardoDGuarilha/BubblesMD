import { Marked } from 'marked';
import type { CandidateDiff, ChangeGroup } from '../core/changes';
import { MINUS_SVG } from './icons';

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

function changeEl(doc: Document, reviewId: string, g: ChangeGroup, text: string): HTMLElement {
  const el = doc.createElement('span');
  el.className = `cand-change ${g.kind}`;
  el.dataset.review = reviewId;
  el.dataset.change = g.id;
  el.dataset.kind = g.kind;
  el.textContent = text;
  return el;
}

function markerEl(doc: Document, reviewId: string, g: ChangeGroup, symbol: string, extra: string): HTMLElement {
  const el = doc.createElement('span');
  el.className = `cand-marker ${g.kind} ${extra}`;
  el.dataset.review = reviewId;
  el.dataset.change = g.id;
  el.dataset.kind = g.kind;
  el.textContent = symbol;
  return el;
}

/** The red − at a deletion point: the candidate's counterpart of the source's green insertion +. */
function deleteEl(doc: Document, reviewId: string, g: ChangeGroup): HTMLElement {
  const el = doc.createElement('span');
  el.className = 'cand-delete deleted';
  el.dataset.review = reviewId;
  el.dataset.change = g.id;
  el.dataset.kind = g.kind;
  el.innerHTML = MINUS_SVG;
  return el;
}

const clip = (s: string) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > 28 ? `${t.slice(0, 27)}…` : t;
};

/** A change that cannot be marked inline, listed by its own text (still hoverable, source-linked and poppable). */
function chipEl(doc: Document, reviewId: string, g: ChangeGroup): HTMLElement {
  const el = doc.createElement('span');
  el.className = `cand-chip ${g.kind}`;
  el.dataset.review = reviewId;
  el.dataset.change = g.id;
  el.dataset.kind = g.kind;
  el.textContent =
    g.kind === 'added' ? `+ “${clip(g.replacement)}”` : g.kind === 'deleted' ? `− “${clip(g.original)}”` : `“${clip(g.original)}” → “${clip(g.replacement)}”`;
  return el;
}

// ---- keeping markers out of the Markdown syntax ----------------------------------------------------------------

const isMarker = (ch: string | undefined) => !!ch && /[\ue000-\ue002\ue100-\uefff]/.test(ch);
type CharClass = 'space' | 'punct' | 'other';
/** marked's classes for emphasis flanking: whitespace (or the text edge), Unicode punctuation/symbols, other. */
const classOf = (ch: string | undefined): CharClass => (!ch || /\s/.test(ch) ? 'space' : /[\p{P}\p{S}]/u.test(ch) ? 'punct' : 'other');
/** CommonMark left/right flanking of a delimiter run between two neighbours. Markers count as 'other'. */
const flanking = (prev: CharClass, next: CharClass) =>
  `${next !== 'space' && (next !== 'punct' || prev !== 'other')}/${prev !== 'space' && (prev !== 'punct' || next !== 'other')}`;
const before = (s: string, i: number) => (/[\udc00-\udfff]/.test(s[i - 1] ?? '') ? s.slice(i - 2, i) : s[i - 1]);
const after = (s: string, i: number) => (i < s.length ? String.fromCodePoint(s.codePointAt(i)!) : undefined);
/** The nearest character that is not a marker, before index i / from index i. */
function realBefore(s: string, i: number) {
  while (i > 0 && isMarker(s[i - 1])) i--;
  return before(s, i);
}
function realAfter(s: string, i: number) {
  while (i < s.length && isMarker(s[i])) i++;
  return after(s, i);
}
const DELIM = /[*_~]/;
const BLOCK_PREFIX = /^(?:#{1,6} |[-*+] |\d{1,9}[.)] |> )+/;

/**
 * Marker characters are invisible after rendering but take part in Markdown parsing, where they count as letters.
 * Next to a `*`/`_`/`~` run that can change whether the run opens or closes emphasis (e.g. `that `+marker+`**[link](…)**`
 * stays literal). A marker cluster touching a run moves to the run's other side only when that restores the run's
 * flanking as it is without markers; a cluster at the start of a line moves past the block marker (`# `, `- `, `1. `,
 * `> `). Both cross only syntax, so the highlighted text is unchanged.
 */
export function keepSyntaxIntact(text: string): string {
  let s = text;
  for (let i = 0; i < s.length; i++) {
    if (!isMarker(s[i])) continue;
    let j = i;
    while (j < s.length && isMarker(s[j])) j++;
    const cluster = s.slice(i, j);
    if (i === 0 || s[i - 1] === '\n') {
      const prefix = BLOCK_PREFIX.exec(s.slice(j))?.[0];
      if (prefix) {
        s = s.slice(0, i) + prefix + cluster + s.slice(j + prefix.length);
        i += prefix.length + cluster.length - 1;
        continue;
      }
    }
    if (DELIM.test(s[j] ?? '')) {
      let k = j;
      while (s[k] === s[j]) k++;
      const truth = flanking(classOf(realBefore(s, i)), classOf(realAfter(s, k)));
      if (flanking('other', classOf(after(s, k))) !== truth && flanking(classOf(before(s, i)), 'other') === truth) {
        s = s.slice(0, i) + s.slice(j, k) + cluster + s.slice(k);
        i = k - 1;
        continue;
      }
    }
    if (DELIM.test(s[i - 1] ?? '')) {
      let h = i - 1;
      while (h > 0 && s[h - 1] === s[i - 1]) h--;
      const truth = flanking(classOf(realBefore(s, h)), classOf(realAfter(s, j)));
      if (flanking(classOf(before(s, h)), 'other') !== truth && flanking('other', classOf(after(s, j))) === truth) {
        s = s.slice(0, h) + cluster + s.slice(h, i) + s.slice(j);
      }
    }
    i = j - 1;
  }
  return s;
}

/** Group indices (into `live`) of every marker cluster that touches Markdown syntax or a line edge. */
function groupsNearSyntax(s: string): Set<number> {
  const near = new Set<number>();
  let open = -1;
  for (let i = 0; i < s.length; i++) {
    if (!isMarker(s[i])) continue;
    let j = i;
    const ids: number[] = [];
    while (j < s.length && isMarker(s[j])) {
      const ch = s[j];
      if ((ch === START || ch === POINT) && s.charCodeAt(j + 1) >= INDEX_BASE) {
        const idx = s.charCodeAt(j + 1) - INDEX_BASE;
        ids.push(idx);
        if (ch === START) open = idx;
        j += 2;
        continue;
      }
      if (ch === END) {
        if (open >= 0) ids.push(open);
        open = -1;
      }
      j++;
    }
    if (/[*_~`[\]()<>!\\#|\n]/.test((s[i - 1] ?? '\n') + (s[j] ?? '\n'))) ids.forEach((id) => near.add(id));
    i = j - 1;
  }
  return near;
}

/** Remove the markers of the given groups (their text stays, unmarked). */
function withoutMarkers(s: string, drop: (idx: number) => boolean): string {
  let out = '';
  let open = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if ((ch === START || ch === POINT) && s.charCodeAt(i + 1) >= INDEX_BASE) {
      const idx = s.charCodeAt(i + 1) - INDEX_BASE;
      if (ch === START) open = idx;
      if (!drop(idx)) out += ch + s[i + 1];
      i++;
      continue;
    }
    if (ch === END) {
      if (!drop(open)) out += ch;
      open = -1;
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * Parse the marked-up text, verifying the result against the same text without markers. If markers still change
 * the parse (an exceptional case, e.g. a change ending in punctuation right against `**[`), the groups whose markers
 * touch syntax are not marked inline (and, as a last resort, none are); they are listed by their text instead, so
 * every change stays identifiable and poppable and the Markdown always renders as it would without markers.
 */
function parseMarked(text: string): string {
  // A paragraph holding only a marker (e.g. a whole deleted selection or paragraph) is the marker's own place.
  const bare = (html: string) => html.replace(SENTINELS, '').replace(/<p><\/p>\n?/g, '');
  const plain = marked.parse(text.replace(SENTINELS, '')) as string;
  let withMarks = keepSyntaxIntact(text);
  let html = marked.parse(withMarks) as string;
  if (bare(html) === plain) return html;
  const near = groupsNearSyntax(withMarks);
  withMarks = withoutMarkers(withMarks, (idx) => near.has(idx));
  html = marked.parse(withMarks) as string;
  if (bare(html) === plain) return html;
  return plain;
}

/**
 * Render the candidate (after pops) with every live change group wrapped in a pop target. Groups are marked
 * with private-use sentinels before Markdown rendering, so a change may cross formatting boundaries; groups
 * that end up with no visible text (e.g. a pure syntax change) get a small marker. `raw` shows the Markdown source.
 * Every pop target carries `data-review` with `data-change`, since change ids are only unique within a review.
 */
export function renderCandidate(diff: CandidateDiff, popped: readonly string[], raw: boolean, reviewId = ''): { root: HTMLElement; groups: ChangeGroup[] } {
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
    root.innerHTML = parseMarked(text);
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
        frag.append(changeEl(doc, reviewId, current, buffer));
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
            frag.append(g.kind === 'deleted' ? deleteEl(doc, reviewId, g) : markerEl(doc, reviewId, g, g.replacement.includes('\n') ? '↵' : '␣', 'ws'));
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
        if (current && !withText.has(current.id)) frag.append(markerEl(doc, reviewId, current, '◆', 'format'));
        current = null;
        continue;
      }
      buffer += ch;
    }
    flush();
    node.replaceWith(frag);
  }
  root.querySelectorAll('a[href]').forEach((a) => a.setAttribute('href', (a.getAttribute('href') ?? '').replace(SENTINELS, '')));

  // Changes that are not marked inline (inside a link destination, or not markable without changing the Markdown)
  // are listed by their own text: hover pairs them with the source, and each one pops individually.
  const unseen = live.filter((g) => !seen.has(g.id));
  if (unseen.length) {
    const p = doc.createElement('p');
    p.className = 'cand-unseen';
    p.append('Not marked inline: ');
    for (const g of unseen) p.append(chipEl(doc, reviewId, g), ' ');
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
