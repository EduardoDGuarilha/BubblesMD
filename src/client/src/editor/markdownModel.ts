import StarterKit from '@tiptap/starter-kit';
import { MarkdownManager } from '@tiptap/markdown';
import { getSchema, type AnyExtension } from '@tiptap/core';
import { Node as PMNode, type Schema } from '@tiptap/pm/model';
import { marked, type Token } from 'marked';

/**
 * The supported formatted subset: paragraphs, headings, emphasis/strong/strike, links, lists, blockquotes,
 * inline/fenced code, hard breaks and thematic breaks. Tiptap's own undo history is disabled: the app owns history.
 */
export function formattedExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({
      undoRedo: false,
      trailingNode: false,
      underline: false,
      link: { openOnClick: false, autolink: false },
    }),
  ];
}

let cached: { schema: Schema; manager: MarkdownManager } | null = null;

function model() {
  if (!cached) {
    const extensions = formattedExtensions();
    cached = { schema: getSchema(extensions), manager: new MarkdownManager({ extensions }) };
  }
  return cached;
}

export function markdownSchema(): Schema {
  return model().schema;
}

export function parseMarkdown(md: string): PMNode {
  const { schema, manager } = model();
  return PMNode.fromJSON(schema, manager.parse(md));
}

export function serializeDoc(doc: PMNode): string {
  return model().manager.serialize(doc.toJSON());
}

const UNSUPPORTED: Record<string, string> = {
  table: 'tables',
  html: 'raw HTML',
  image: 'images',
  def: 'link reference definitions',
};

function scan(tokens: Token[], found: Set<string>) {
  for (const t of tokens) {
    const label = UNSUPPORTED[t.type];
    if (label) found.add(label);
    const nested = t as Token & { tokens?: Token[]; items?: Token[] };
    if (nested.tokens) scan(nested.tokens, found);
    if (nested.items) scan(nested.items, found);
  }
}

export interface FormattedSupport {
  /** Unsupported constructs that Formatted mode would rewrite or drop; non-empty means Formatted mode is read-only. */
  unsupported: string[];
  /** Supported, but Formatted editing would normalize some syntax (e.g. `__a__` → `**a**`). */
  normalizes: boolean;
}

/** Constructs Formatted mode cannot represent; cheap enough to run on every change. */
export function scanUnsupported(md: string): string[] {
  const found = new Set<string>();
  const tokens = marked.lexer(md);
  scan(tokens, found);
  if ('links' in tokens && Object.keys((tokens as unknown as { links: object }).links).length > 0) {
    found.add(UNSUPPORTED.def);
  }
  return [...found];
}

export function checkFormattedSupport(md: string): FormattedSupport {
  const unsupported = scanUnsupported(md);
  return { unsupported, normalizes: unsupported.length === 0 && serializeDoc(parseMarkdown(md)).trimEnd() !== md.trimEnd() };
}
