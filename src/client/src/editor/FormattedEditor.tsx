import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Editor, Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { buildBridge, type Bridge } from '../core/bridge';
import { diffText } from '../core/textChanges';
import type { ChangeKind } from '../core/changes';
import { formattedExtensions, parseMarkdown, serializeDoc } from './markdownModel';
import { textRects, type DecorationSpec, type EditorCallbacks, type EditorHandle } from './types';
import { PLUS_SVG } from '../ui/PlusIcon';

const EXTERNAL = 'bubblesExternal';
const decoKey = new PluginKey<DecorationSet>('bubblesDecorations');

export type FormatCommand = 'bold' | 'italic' | 'heading' | 'bulletList' | 'orderedList' | 'blockquote' | 'code';

export interface FormattedHandle extends EditorHandle {
  format(cmd: FormatCommand): void;
}

interface Props {
  md: string;
  spec: DecorationSpec;
  readOnly: boolean;
  callbacks: EditorCallbacks;
  onBridgeError(message: string): void;
}

export const KIND_LABEL: Record<ChangeKind, string> = { added: 'Added', altered: 'Altered', deleted: 'Deleted' };

/**
 * Formatted (Tiptap) adapter. The canonical Markdown string is owned by the store: user transactions are
 * serialized and reported as Markdown hunks; external Markdown (undo/redo/accept) is applied as a minimal
 * document replace. Tiptap's own history is disabled.
 */
export const FormattedEditor = forwardRef<FormattedHandle, Props>(function FormattedEditor(
  { md, spec, readOnly, callbacks, onBridgeError },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const mdRef = useRef(md);
  const cbRef = useRef(callbacks);
  cbRef.current = callbacks;
  const bridgeErrorRef = useRef(onBridgeError);
  bridgeErrorRef.current = onBridgeError;
  const cache = useRef<{ doc: PMNode; md: string; bridge: Bridge } | null>(null);

  const bridgeFor = (doc: PMNode, text: string): Bridge => {
    const c = cache.current;
    if (c && c.doc === doc && c.md === text) return c.bridge;
    const bridge = buildBridge(doc, text);
    cache.current = { doc, md: text, bridge };
    return bridge;
  };

  const currentBridge = (): Bridge | null => {
    const editor = editorRef.current;
    return editor ? bridgeFor(editor.state.doc, mdRef.current) : null;
  };

  useEffect(() => {
    const ext = Extension.create({
      name: 'bubbles',
      addKeyboardShortcuts: () => ({
        'Mod-z': () => (cbRef.current.onUndo(), true),
        'Mod-y': () => (cbRef.current.onRedo(), true),
        'Shift-Mod-z': () => (cbRef.current.onRedo(), true),
        'Mod-Alt-m': () => (cbRef.current.onCreateBubble(), true),
      }),
      addProseMirrorPlugins: () => [
        new Plugin({
          key: decoKey,
          state: {
            init: () => DecorationSet.empty,
            apply: (tr, old) => (tr.getMeta(decoKey) as DecorationSet | undefined) ?? old.map(tr.mapping, tr.doc),
          },
          props: {
            decorations: (state) => decoKey.getState(state),
            handleDOMEvents: {
              mousedown: (_view, event) => {
                const el = (event.target as HTMLElement).closest<HTMLElement>('[data-change]');
                if (!el) return false;
                event.preventDefault();
                cbRef.current.onSourceChange(el.dataset.change!, el.dataset.kind as ChangeKind);
                return true;
              },
            },
          },
        }),
      ],
    });

    const editor = new Editor({
      element: hostRef.current!,
      extensions: [...formattedExtensions(), ext],
      content: md.trim() ? parseMarkdown(md).toJSON() : null,
      editable: !readOnly,
      editorProps: { attributes: { class: 'prose', spellcheck: 'true', 'aria-label': 'Document (formatted)' } },
    });
    editorRef.current = editor;

    const onTransaction = ({ transaction: tr }: { transaction: Transaction }) => {
      cbRef.current.onLayoutChange();
      if (!tr.docChanged || tr.getMeta(EXTERNAL)) return;
      const oldMd = mdRef.current;
      const newMd = serializeDoc(tr.doc).trimEnd() + (/\s*$/.exec(oldMd)?.[0] ?? '');
      if (newMd === oldMd) return;
      let hint: number | undefined;
      let oldStart = -1;
      tr.mapping.maps[0]?.forEach((start) => {
        if (oldStart < 0) oldStart = start;
      });
      if (oldStart >= 0) {
        const bridge = bridgeFor(tr.before, oldMd);
        if (bridge.ok) {
          const $pos = tr.before.resolve(Math.min(oldStart, tr.before.content.size));
          hint = bridge.pmToMd(oldStart, $pos.parentOffset === 0 ? 'start' : 'end');
        }
      }
      mdRef.current = newMd;
      cbRef.current.onEdit(newMd, diffText(oldMd, newMd, hint));
    };
    editor.on('transaction', onTransaction);
    editor.on('selectionUpdate', () => cbRef.current.onSelectionChange());
    editor.on('blur', () => cbRef.current.onSelectionChange());
    return () => {
      editor.destroy();
      editorRef.current = null;
    };
    // The editor is created once; later props are applied by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    editorRef.current?.setEditable(!readOnly);
  }, [readOnly]);

  // Apply external Markdown (undo/redo/accept/load), then redraw review decorations for the current state.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    queueMicrotask(() => {
      if (editor.isDestroyed) return;
      const view = editor.view;
      if (md !== mdRef.current) {
        // Parse with the editor's own schema instance; nodes from another schema never compare equal.
        const next = view.state.schema.nodeFromJSON(parseMarkdown(md).toJSON());
        const oldDoc = view.state.doc;
        mdRef.current = md;
        const start = oldDoc.content.findDiffStart(next.content);
        if (start != null) {
          let { a: endA, b: endB } = oldDoc.content.findDiffEnd(next.content)!;
          const overlap = start - Math.min(endA, endB);
          if (overlap > 0) {
            endA += overlap;
            endB += overlap;
          }
          const tr = view.state.tr.replace(start, endA, next.slice(start, endB));
          tr.setMeta(EXTERNAL, true).setMeta('addToHistory', false);
          try {
            tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(endB, tr.doc.content.size))));
          } catch {
            /* keep default selection */
          }
          view.dispatch(tr);
        }
      }
      const doc = view.state.doc;
      const bridge = bridgeFor(doc, mdRef.current);
      const decorations: Decoration[] = [];
      if (!bridge.ok) {
        bridgeErrorRef.current(bridge.error ?? 'Formatted view could not map this document.');
      } else {
        // Invisible passage anchors for every open review (highlighted from a scoped style rule, never by DOM edits).
        for (const a of spec.anchors) {
          const from = bridge.mdToPm(a.from, 'start');
          const to = bridge.mdToPm(a.to, 'end');
          if (from < to) decorations.push(Decoration.inline(from, to, { class: `rt rt-${a.id}` }));
        }
        const review = spec.reviewId ?? '';
        if (spec.target) {
          const from = bridge.mdToPm(spec.target.from, 'start');
          const to = bridge.mdToPm(spec.target.to, 'end');
          if (from < to) decorations.push(Decoration.inline(from, to, { class: 'src-target' }));
        }
        for (const c of spec.changes) {
          const label = KIND_LABEL[c.kind];
          const from = bridge.mdToPm(c.from, 'start');
          const to = bridge.mdToPm(c.to, 'end');
          if (c.kind !== 'added' && from < to) {
            decorations.push(
              Decoration.inline(from, to, {
                class: `src-change ${c.kind}`,
                'data-review': review,
                'data-change': c.id,
                'data-kind': c.kind,
                title: `${label} — click to keep the original wording`,
              }),
            );
          } else {
            const pos = c.kind === 'added' ? bridge.mdToPm(c.from, 'end') : from;
            decorations.push(
              Decoration.widget(pos, () => sourceMarker(review, c.id, c.kind), { side: 1, key: `${review}-${c.id}-${c.kind}`, ignoreSelection: true }),
            );
          }
        }
      }
      view.dispatch(view.state.tr.setMeta(decoKey, DecorationSet.create(doc, decorations)).setMeta(EXTERNAL, true));
    });
  }, [md, spec]);

  useImperativeHandle(ref, () => ({
    getSelection() {
      const editor = editorRef.current;
      if (!editor) return null;
      const { from, to, empty } = editor.state.selection;
      if (empty) return null;
      const bridge = currentBridge()!;
      if (!bridge.ok) return { error: `This selection cannot be mapped to Markdown (${bridge.error}).` };
      const mdFrom = bridge.pmToMd(from, 'start');
      const mdTo = bridge.pmToMd(to, 'end');
      return mdFrom < mdTo ? { from: mdFrom, to: mdTo } : null;
    },
    rectFor(from, to) {
      const editor = editorRef.current;
      const bridge = currentBridge();
      if (!editor || !bridge?.ok) return null;
      const size = editor.state.doc.content.size;
      const a = Math.min(bridge.mdToPm(from, 'start'), size);
      const b = Math.max(a, Math.min(bridge.mdToPm(to, 'end'), size));
      try {
        const start = editor.view.coordsAtPos(a, 1);
        const end = editor.view.coordsAtPos(b, -1);
        return { top: start.top, bottom: Math.max(end.bottom, start.bottom), left: start.left, right: end.right };
      } catch {
        return null;
      }
    },
    selectionRects() {
      const view = editorRef.current?.view;
      if (!view || view.state.selection.empty) return [];
      const { from, to } = view.state.selection;
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
      const editor = editorRef.current;
      const bridge = currentBridge();
      if (!editor || !bridge?.ok) return;
      const pos = Math.min(bridge.mdToPm(offset, 'start'), editor.state.doc.content.size);
      const { node } = editor.view.domAtPos(pos);
      const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement);
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    },
    focus() {
      editorRef.current?.commands.focus();
    },
    hasFocus() {
      return !!editorRef.current?.view.hasFocus();
    },
    format(cmd) {
      const chain = editorRef.current?.chain().focus();
      if (!chain) return;
      const run = {
        bold: () => chain.toggleBold(),
        italic: () => chain.toggleItalic(),
        heading: () => chain.toggleHeading({ level: 2 }),
        bulletList: () => chain.toggleBulletList(),
        orderedList: () => chain.toggleOrderedList(),
        blockquote: () => chain.toggleBlockquote(),
        code: () => chain.toggleCode(),
      }[cmd];
      run().run();
    },
  }), []);

  return <div ref={hostRef} className="editor-host formatted" />;
});

function sourceMarker(reviewId: string, id: string, kind: ChangeKind): HTMLElement {
  const el = document.createElement('span');
  el.className = kind === 'added' ? 'src-insert' : `src-point ${kind}`;
  el.dataset.review = reviewId;
  el.dataset.change = id;
  el.dataset.kind = kind;
  if (kind === 'added') el.innerHTML = PLUS_SVG;
  else el.textContent = '◆';
  el.title = kind === 'added' ? 'Added — click to remove this addition' : `${KIND_LABEL[kind]} formatting — click to keep the original`;
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', el.title);
  el.contentEditable = 'false';
  return el;
}
