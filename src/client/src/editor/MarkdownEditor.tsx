import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Annotation, EditorState, StateEffect, StateField, type Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, keymap, type DecorationSet } from '@codemirror/view';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { ChangeKind } from '../core/changes';
import { diffText, type Hunk } from '../core/textChanges';
import { KIND_LABEL } from './FormattedEditor';
import type { DecorationSpec, EditorCallbacks, EditorHandle } from './types';

const External = Annotation.define<boolean>();
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
    readonly id: string,
    readonly kind: ChangeKind,
  ) {
    super();
  }
  eq(other: MarkerWidget) {
    return other.id === this.id && other.kind === this.kind;
  }
  toDOM() {
    const el = document.createElement('span');
    el.className = this.kind === 'added' ? 'src-insert' : `src-point ${this.kind}`;
    el.dataset.change = this.id;
    el.dataset.kind = this.kind;
    el.textContent = this.kind === 'added' ? '+' : '◆';
    el.title = this.kind === 'added' ? 'Added — show the proposed text' : `${KIND_LABEL[this.kind]} — click to keep the original`;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', el.title);
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
          syntaxHighlighting(defaultHighlightStyle),
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
  if (spec.target && spec.target.from < spec.target.to) {
    ranges.push(Decoration.mark({ class: 'src-target' }).range(clamp(spec.target.from), clamp(spec.target.to)));
  }
  for (const c of spec.changes) {
    if (c.kind !== 'added' && c.from < c.to) {
      ranges.push(
        Decoration.mark({
          class: `src-change ${c.kind}`,
          attributes: { 'data-change': c.id, 'data-kind': c.kind, title: `${KIND_LABEL[c.kind]} — click to keep the original wording` },
        }).range(clamp(c.from), clamp(c.to)),
      );
    } else {
      ranges.push(Decoration.widget({ widget: new MarkerWidget(c.id, c.kind), side: 1 }).range(clamp(c.from)));
    }
  }
  return Decoration.set(ranges, true);
}
