import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Annotation, EditorState, StateEffect, StateField, type Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, keymap, type DecorationSet } from '@codemirror/view';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import type { ChangeKind } from '../core/changes';
import { diffText, type Hunk } from '../core/textChanges';
import { KIND_LABEL, sourceMarker } from './FormattedEditor';
import { textRects, type DecorationSpec, type EditorCallbacks, type EditorHandle } from './types';
import { PLUS_SVG } from '../ui/icons';

const External = Annotation.define<boolean>();

/** Quiet, theme-aware Markdown highlighting that uses the app's CSS variables in light and dark mode. */
const markdownHighlight = HighlightStyle.define([
  { tag: tags.heading, fontWeight: '650' },
  { tag: tags.heading1, fontSize: '1.15em' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link, color: 'var(--edge)' },
  { tag: tags.url, color: 'var(--quiet)' },
  { tag: [tags.processingInstruction, tags.meta, tags.contentSeparator], color: 'var(--quiet)' },
  { tag: tags.quote, color: 'var(--quiet)' },
  { tag: tags.monospace, color: 'var(--ink)' },
]);
const setDecorations = StateEffect.define<DecorationSet>();

const decorationField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setDecorations)) return e.value;
    return value.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

class MarkerWidget extends WidgetType {
  constructor(
    readonly reviewId: string,
    readonly id: string,
    readonly kind: ChangeKind,
    readonly lineBreak = false,
  ) {
    super();
  }
  eq(other: MarkerWidget) {
    return other.reviewId === this.reviewId && other.id === this.id && other.kind === this.kind && other.lineBreak === this.lineBreak;
  }
  toDOM() {
    if (this.lineBreak) return sourceMarker(this.reviewId, this.id, this.kind, true);
    const el = document.createElement('span');
    el.className = this.kind === 'added' ? 'src-insert' : `src-point ${this.kind}`;
    el.dataset.review = this.reviewId;
    el.dataset.change = this.id;
    el.dataset.kind = this.kind;
    if (this.kind === 'added') el.innerHTML = PLUS_SVG;
    else el.textContent = '◆';
    el.title = this.kind === 'added' ? 'Added — click to remove this addition' : `${KIND_LABEL[this.kind]} — click to keep the original`;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', el.title);
    if (this.kind === 'added') {
      // Syntax styling enlarges only the text token (e.g. a heading); take the size of the text this marker follows,
      // so its circle stays centred on that text, as in Formatted view.
      requestAnimationFrame(() => {
        let text = el.previousSibling;
        while (text && text.nodeName === 'IMG') text = text.previousSibling; // CodeMirror's widget buffers
        while (text && text.nodeType !== Node.TEXT_NODE) text = text.lastChild;
        if (text?.parentElement && text.parentElement !== el.parentElement) el.style.fontSize = getComputedStyle(text.parentElement).fontSize;
      });
    }
    return el;
  }
  ignoreEvent() {
    return false;
  }
}

interface Props {
  md: string;
  spec: DecorationSpec;
  callbacks: EditorCallbacks;
}

/** Editable Markdown (CodeMirror 6) adapter. Its own history is not installed: the app owns Undo/Redo. */
export const MarkdownEditor = forwardRef<EditorHandle, Props>(function MarkdownEditor({ md, spec, callbacks }, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const cbRef = useRef(callbacks);
  cbRef.current = callbacks;

  useEffect(() => {
    const view = new EditorView({
      parent: hostRef.current!,
      state: EditorState.create({
        doc: md,
        extensions: [
          keymap.of([
            { key: 'Mod-z', run: () => (cbRef.current.onUndo(), true) },
            { key: 'Mod-y', run: () => (cbRef.current.onRedo(), true) },
            { key: 'Mod-Shift-z', run: () => (cbRef.current.onRedo(), true) },
            { key: 'Mod-Alt-m', run: () => (cbRef.current.onCreateBubble(), true) },
            indentWithTab,
            ...defaultKeymap,
          ]),
          markdown(),
          syntaxHighlighting(markdownHighlight),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ 'aria-label': 'Document (Markdown source)', spellcheck: 'true' }),
          decorationField,
          EditorView.domEventHandlers({
            mousedown: (event) => {
              const el = (event.target as HTMLElement).closest<HTMLElement>('[data-change]');
              if (!el) return false;
              event.preventDefault();
              cbRef.current.onSourceChange(el.dataset.change!, el.dataset.kind as ChangeKind);
              return true;
            },
          }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !u.transactions.some((t) => t.annotation(External))) {
              const hunks: Hunk[] = [];
              u.changes.iterChanges((fromA, toA, fromB, toB) => hunks.push({ fromA, toA, fromB, toB }));
              cbRef.current.onEdit(u.state.doc.toString(), hunks);
            }
            if (u.selectionSet || u.focusChanged) cbRef.current.onSelectionChange();
            if (u.docChanged || u.geometryChanged || u.viewportChanged) cbRef.current.onLayoutChange();
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    const effects = [setDecorations.of(buildDecorations(spec, md.length))];
    if (current !== md) {
      const hunks = diffText(current, md);
      const changes = hunks.map((h) => ({ from: h.fromA, to: h.toA, insert: md.slice(h.fromB, h.toB) }));
      const last = hunks[hunks.length - 1];
      view.dispatch({
        changes,
        effects,
        annotations: External.of(true),
        selection: last ? { anchor: Math.min(md.length, last.toB) } : undefined,
      });
    } else {
      view.dispatch({ effects });
    }
  }, [md, spec]);

  useImperativeHandle(ref, () => ({
    getSelection() {
      const view = viewRef.current;
      if (!view) return null;
      const { from, to } = view.state.selection.main;
      return from < to ? { from, to } : null;
    },
    rectFor(from, to) {
      const view = viewRef.current;
      if (!view) return null;
      const len = view.state.doc.length;
      const a = view.coordsAtPos(Math.min(from, len), 1);
      const b = view.coordsAtPos(Math.min(Math.max(from, to), len), -1);
      if (!a) return null;
      return { top: a.top, bottom: Math.max(b?.bottom ?? a.bottom, a.bottom), left: a.left, right: b?.right ?? a.right };
    },
    selectionRects() {
      const view = viewRef.current;
      if (!view || view.state.selection.main.empty) return [];
      const { from, to } = view.state.selection.main;
      try {
        const a = view.domAtPos(from);
        const b = view.domAtPos(to);
        const range = document.createRange();
        range.setStart(a.node, a.offset);
        range.setEnd(b.node, b.offset);
        return textRects(range);
      } catch {
        return [];
      }
    },
    scrollTo(offset) {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({ effects: EditorView.scrollIntoView(Math.min(offset, view.state.doc.length), { y: 'center' }) });
    },
    focus() {
      viewRef.current?.focus();
    },
    hasFocus() {
      return !!viewRef.current?.hasFocus;
    },
  }), []);

  return <div ref={hostRef} className="editor-host markdown" />;
});

function buildDecorations(spec: DecorationSpec, length: number): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const clamp = (n: number) => Math.max(0, Math.min(n, length));
  const review = spec.reviewId ?? '';
  // Invisible passage anchors for every open review (highlighted from a scoped style rule, never by DOM edits).
  for (const a of spec.anchors) {
    if (clamp(a.from) < clamp(a.to)) ranges.push(Decoration.mark({ class: `rt rt-${a.id}` }).range(clamp(a.from), clamp(a.to)));
  }
  if (spec.target && spec.target.from < spec.target.to) {
    ranges.push(Decoration.mark({ class: 'src-target' }).range(clamp(spec.target.from), clamp(spec.target.to)));
  }
  for (const c of spec.changes) {
    if (c.ws === 'break') {
      // A changed line break keeps its structure; a zero-width badge marks it at the end of the line.
      ranges.push(Decoration.widget({ widget: new MarkerWidget(review, c.id, c.kind, true), side: -1 }).range(clamp(c.from)));
    } else if (c.kind !== 'added' && c.from < c.to) {
      ranges.push(
        Decoration.mark({
          class: `src-change ${c.kind}${c.ws ? ' ws' : ''}`,
          attributes: { 'data-review': review, 'data-change': c.id, 'data-kind': c.kind, title: `${KIND_LABEL[c.kind]} — click to keep the original wording` },
        }).range(clamp(c.from), clamp(c.to)),
      );
    } else {
      ranges.push(Decoration.widget({ widget: new MarkerWidget(review, c.id, c.kind), side: 1 }).range(clamp(c.from)));
    }
  }
  return Decoration.set(ranges, true);
}
