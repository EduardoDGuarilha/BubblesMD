import { describe, expect, it } from 'vitest';
import type { Node as PMNode } from '@tiptap/pm/model';
import { buildBridge } from './bridge';
import { checkFormattedSupport, parseMarkdown, serializeDoc } from '../editor/markdownModel';

/** PM range of the n-th (0-based) occurrence of `text` inside a single text node run of the document. */
function pmRangeOf(doc: PMNode, text: string, nth = 0): { from: number; to: number } {
  let seen = 0;
  let found: { from: number; to: number } | null = null;
  doc.descendants((node, pos) => {
    if (found || !node.isText) return !found;
    let idx = node.text!.indexOf(text);
    while (idx >= 0 && !found) {
      if (seen === nth) found = { from: pos + idx, to: pos + idx + text.length };
      seen++;
      idx = node.text!.indexOf(text, idx + 1);
    }
    return !found;
  });
  if (!found) throw new Error(`occurrence ${nth} of "${text}" not found`);
  return found;
}

function mdRange(doc: PMNode, md: string, r: { from: number; to: number }) {
  const bridge = buildBridge(doc, md);
  expect(bridge.error).toBeUndefined();
  return { from: bridge.pmToMd(r.from, 'start'), to: bridge.pmToMd(r.to, 'end'), bridge };
}

const FIXTURES = [
  '# Title\n\nHello **world** and *world* again with `world` code.',
  'See [example.com](https://example.com/example.com) and example.com too.',
  '- one\n- two\n  - two nested\n  - three\n\n1. first\n2. second',
  '> quoted **bold** line\n> second line\n\nAfter.',
  '```md\n- not a list\n# not heading\n```\n\nText after code.',
  'Escaped \\* star and 5 &lt; 6 entity.',
  'Line one\nsoft break line.\n\n---\n\nAfter rule.',
  'Hard  \nbreak here.',
];

describe('PM ↔ Markdown bridge on supported Markdown', () => {
  it('aligns every fixture without error and round-trips text positions', () => {
    for (const md of FIXTURES) {
      const doc = parseMarkdown(md);
      for (const source of [md, serializeDoc(doc)]) {
        const bridge = buildBridge(doc, source);
        expect(bridge.error, md).toBeUndefined();
        doc.descendants((node, pos) => {
          if (node.isText) {
            for (let i = 0; i < node.text!.length; i++) {
              const off = bridge.pmToMd(pos + i, 'start');
              expect(bridge.mdToPm(off, 'start'), `${md} @${pos + i}`).toBe(pos + i);
            }
          }
          return true;
        });
      }
    }
  });

  it('maps a repeated word to the selected occurrence, not the first one', () => {
    const md = FIXTURES[0];
    const doc = parseMarkdown(md);
    const r = mdRange(doc, md, pmRangeOf(doc, 'world', 1));
    expect(md.slice(r.from, r.to)).toBe('world');
    expect(r.from).toBe(md.indexOf(' *world*') + 2);
    const code = mdRange(doc, md, pmRangeOf(doc, 'world', 2));
    expect(code.from).toBe(md.indexOf('`world`') + 1);
  });

  it('keeps link text separate from an identical URL', () => {
    const md = FIXTURES[1];
    const doc = parseMarkdown(md);
    const link = mdRange(doc, md, pmRangeOf(doc, 'example.com', 0));
    expect(link).toMatchObject({ from: 5, to: 16 });
    const plain = mdRange(doc, md, pmRangeOf(doc, 'example.com', 1));
    expect(plain.from).toBe(md.lastIndexOf('example.com'));
  });

  it('maps nested list items and ordered items past their markers', () => {
    const md = FIXTURES[2];
    const doc = parseMarkdown(md);
    const nested = mdRange(doc, md, pmRangeOf(doc, 'two nested'));
    expect(nested.from).toBe(md.indexOf('two nested'));
    const second = mdRange(doc, md, pmRangeOf(doc, 'second'));
    expect(md.slice(second.from, second.to)).toBe('second');
  });

  it('does not treat Markdown-looking code content as syntax', () => {
    const md = FIXTURES[4];
    const doc = parseMarkdown(md);
    const r = mdRange(doc, md, pmRangeOf(doc, '# not heading'));
    expect(md.slice(r.from, r.to)).toBe('# not heading');
  });

  it('captures inner emphasis and cross-block selections exactly', () => {
    const md = FIXTURES[3];
    const doc = parseMarkdown(md);
    const bold = mdRange(doc, md, pmRangeOf(doc, 'bold'));
    expect(md.slice(bold.from, bold.to)).toBe('bold');
    const start = pmRangeOf(doc, 'second line').from;
    const end = pmRangeOf(doc, 'After').to;
    const cross = mdRange(doc, md, { from: start, to: end });
    expect(md.slice(cross.from, cross.to)).toBe('second line\n\nAfter');
  });

  it('maps a Markdown range back to a document range for decorations', () => {
    const md = FIXTURES[0];
    const doc = parseMarkdown(md);
    const from = md.indexOf(' *world*') + 2;
    const { bridge } = mdRange(doc, md, { from: 0, to: 0 });
    const pmFrom = bridge.mdToPm(from, 'start');
    const pmTo = bridge.mdToPm(from + 5, 'end');
    expect(doc.textBetween(pmFrom, pmTo)).toBe('world');
    expect(pmFrom).toBe(pmRangeOf(doc, 'world', 1).from);
  });

  it('fails loudly instead of guessing when Markdown and document disagree', () => {
    const doc = parseMarkdown('Hello world');
    expect(buildBridge(doc, 'Hello brave world').ok).toBe(false);
  });
});

describe('formatted support check', () => {
  it('flags genuinely unsupported content only', () => {
    expect(checkFormattedSupport('| a | b |\n|---|---|\n| 1 | 2 |').unsupported).toContain('tables');
    expect(checkFormattedSupport('<div>x</div>').unsupported).toContain('raw HTML');
    expect(checkFormattedSupport('![alt](x.png)').unsupported).toContain('images');
    for (const md of FIXTURES) expect(checkFormattedSupport(md).unsupported, md).toEqual([]);
    expect(checkFormattedSupport('__strong__').normalizes).toBe(true);
  });
});
