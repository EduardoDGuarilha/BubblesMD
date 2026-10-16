import type { ChangeKind } from '../core/changes';

/** What the active review wants drawn on the source. Ranges are canonical Markdown offsets. */
export interface DecorationSpec {
  /** The expanded review the target and change markings belong to; they carry its id as `data-review`. */
  reviewId: string | null;
  target: { from: number; to: number } | null;
  /** `ws`: the original is whitespace only, shown with a ␣ / ↵ symbol (presentation only). */
  changes: { id: string; kind: ChangeKind; from: number; to: number; ws?: 'space' | 'break' }[];
  /** Every open review's passage, marked invisibly (`rt-<id>`) so it can be highlighted without touching editor DOM. */
  anchors: { id: string; from: number; to: number }[];
}

export const EMPTY_SPEC: DecorationSpec = { reviewId: null, target: null, changes: [], anchors: [] };

export interface EditorRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Imperative surface both editor views expose to the app. All offsets are canonical Markdown offsets. */
export interface EditorHandle {
  /** Current non-empty selection as Markdown offsets, null if empty, or an error when it cannot be mapped. */
  getSelection(): { from: number; to: number } | { error: string } | null;
  /** Viewport rectangle spanning a Markdown range (top of its start, bottom of its end). */
  rectFor(from: number, to: number): EditorRect | null;
  /** Viewport rectangles of the current selection's text, one per line fragment (empty when nothing is selected). */
  selectionRects(): DOMRect[];
  scrollTo(offset: number): void;
  focus(): void;
  hasFocus(): boolean;
}

export interface EditorCallbacks {
  onEdit(md: string, hunks: import('../core/textChanges').Hunk[]): void;
  onSelectionChange(): void;
  onLayoutChange(): void;
  onUndo(): void;
  onRedo(): void;
  onCreateBubble(): void;
  onSourceChange(changeId: string, kind: ChangeKind): void;
}

/** Rectangles of the text inside a DOM range, one per line fragment (element boxes of whole paragraphs excluded). */
export function textRects(range: Range): DOMRect[] {
  const root = range.commonAncestorContainer;
  const rects: DOMRect[] = [];
  const add = (node: Text) => {
    const r = document.createRange();
    r.setStart(node, node === range.startContainer ? range.startOffset : 0);
    r.setEnd(node, node === range.endContainer ? range.endOffset : node.length);
    for (const rect of r.getClientRects()) if (rect.width > 0.5 && rect.height > 0) rects.push(rect);
  };
  if (root.nodeType === Node.TEXT_NODE) add(root as Text);
  else {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      if (range.intersectsNode(node) && !node.parentElement?.closest('[contenteditable="false"]')) add(node);
    }
  }
  return rects;
}
