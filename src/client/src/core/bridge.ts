import type { Node as PMNode } from '@tiptap/pm/model';

/**
 * Position bridge between a ProseMirror document (Formatted view) and the canonical Markdown string it was parsed
 * from or serialized to. Every visible text character of the document is aligned, in order, to a character of the
 * Markdown; everything left unmatched must be Markdown syntax. Anything else (e.g. stray letters) makes the bridge
 * fail loudly instead of guessing a position.
 */
export interface Bridge {
  ok: boolean;
  error?: string;
  /** Markdown offset for a document position. 'start' skips syntax forward to the next text; 'end' stays after the previous text. */
  pmToMd(pos: number, side: 'start' | 'end'): number;
  /** Document position for a Markdown offset, with the same side semantics. */
  mdToPm(off: number, side: 'start' | 'end'): number;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const ENTITY = /^&(#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z]{2,8});/;
const FENCE_OPEN = /^[ \t>]*(?:(?:[-+*]|\d{1,9}[.)])[ \t]+)?[ \t>]*(`{3,}|~{3,})/;
const THEMATIC = /^[ \t>]*(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const BLOCK_PREFIX = /^(?:[ \t]*(?:>[ \t]?|[-+*][ \t]+|\d{1,9}[.)][ \t]+))*[ \t]*(?:#{1,6}(?=[ \t]|$)[ \t]*)?/;
const LINK_DEST = /\]\((?:[^()\n\\]|\\.|\([^()\n]*\))*\)/g;

const isSpace = (c: string) => /\s/.test(c);
const isWordChar = (c: string) => /[\p{L}\p{N}]/u.test(c);

function decodeEntity(md: string, j: number): { text: string; len: number } | null {
  const m = ENTITY.exec(md.slice(j, j + 12));
  if (!m) return null;
  const body = m[1];
  let text: string | undefined;
  if (body[0] === '#') {
    const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    text = Number.isFinite(code) ? String.fromCodePoint(code) : undefined;
  } else text = ENTITIES[body];
  return text ? { text, len: m[0].length } : null;
}

/** Characters that can never correspond to document text: block prefixes, fences, rules, link destinations. */
function syntaxMask(md: string): Uint8Array {
  const mask = new Uint8Array(md.length);
  const markRange = (from: number, to: number) => mask.fill(1, from, to);
  let lineStart = 0;
  let fence: string | null = null;
  while (lineStart <= md.length) {
    let lineEnd = md.indexOf('\n', lineStart);
    if (lineEnd < 0) lineEnd = md.length;
    const line = md.slice(lineStart, lineEnd);
    if (fence) {
      const close = new RegExp(`^[ \\t>]*${fence[0] === '`' ? '`' : '~'}{${fence.length},}[ \\t]*$`);
      if (close.test(line)) {
        markRange(lineStart, lineEnd);
        fence = null;
      }
    } else {
      const open = FENCE_OPEN.exec(line);
      if (open) {
        markRange(lineStart, lineEnd);
        fence = open[1];
      } else if (THEMATIC.test(line)) {
        markRange(lineStart, lineEnd);
      } else {
        const prefix = BLOCK_PREFIX.exec(line);
        if (prefix && prefix[0].length > 0) markRange(lineStart, lineStart + prefix[0].length);
      }
    }
    lineStart = lineEnd + 1;
  }
  for (const m of md.matchAll(LINK_DEST)) markRange(m.index + 1, m.index + m[0].length);
  return mask;
}

function lowerBound(arr: Int32Array, n: number, value: number): number {
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function buildBridge(doc: PMNode, md: string): Bridge {
  const pmPositions: number[] = [];
  const chars: string[] = [];
  doc.descendants((node, pos) => {
    if (node.isText) {
      const text = node.text ?? '';
      for (let i = 0; i < text.length; i++) {
        pmPositions.push(pos + i);
        chars.push(text[i]);
      }
    }
    return true;
  });

  const n = chars.length;
  const pm = Int32Array.from(pmPositions);
  const mdStart = new Int32Array(n);
  const mdEnd = new Int32Array(n);
  const mask = syntaxMask(md);
  let error: string | undefined;

  let j = 0;
  for (let k = 0; k < n && !error; k++) {
    const c = chars[k];
    for (;;) {
      if (j >= md.length) {
        if (isSpace(c)) {
          mdStart[k] = mdEnd[k] = j;
          break;
        }
        error = `Document text "${chars.slice(k, k + 20).join('')}" has no Markdown counterpart`;
        break;
      }
      const m = md[j];
      if (!mask[j]) {
        if (m === c || (isSpace(c) && isSpace(m))) {
          mdStart[k] = j;
          mdEnd[k] = j + 1;
          j++;
          break;
        }
        if (m === '&') {
          const entity = decodeEntity(md, j);
          if (entity && entity.text === c) {
            mdStart[k] = j;
            mdEnd[k] = j + entity.len;
            j += entity.len;
            break;
          }
        }
        if (isWordChar(m)) {
          if (isSpace(c)) {
            // Whitespace that exists only in the document (e.g. normalized spacing) maps to a zero-width point.
            mdStart[k] = mdEnd[k] = j;
            break;
          }
          error = `Markdown text near offset ${j} does not align with the document`;
          break;
        }
      }
      j++;
    }
  }
  if (!error) {
    for (let r = j; r < md.length; r++) {
      if (!mask[r] && isWordChar(md[r])) {
        error = `Markdown text near offset ${r} is not part of the document`;
        break;
      }
    }
  }

  const pmToMd = (pos: number, side: 'start' | 'end'): number => {
    if (n === 0) return 0;
    if (side === 'start') {
      const k = lowerBound(pm, n, pos);
      return k < n ? mdStart[k] : mdEnd[n - 1];
    }
    const k = lowerBound(pm, n, pos) - 1;
    return k >= 0 ? mdEnd[k] : mdStart[0];
  };

  const mdToPm = (off: number, side: 'start' | 'end'): number => {
    if (n === 0) return 1;
    if (side === 'start') {
      const k = lowerBound(mdStart, n, off);
      return k < n ? pm[k] : pm[n - 1] + 1;
    }
    // Last character whose Markdown ends at or before off.
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (mdEnd[mid] <= off) lo = mid + 1;
      else hi = mid;
    }
    const k = lo - 1;
    return k >= 0 ? pm[k] + 1 : pm[0];
  };

  return { ok: !error, error, pmToMd, mdToPm };
}
