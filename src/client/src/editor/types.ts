import type { ChangeKind } from '../core/changes';

/** What the active review wants drawn on the source. Ranges are canonical Markdown offsets. */
export interface DecorationSpec {
  target: { from: number; to: number } | null;
  changes: { id: string; kind: ChangeKind; from: number; to: number }[];
}

export const EMPTY_SPEC: DecorationSpec = { target: null, changes: [] };

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
  scrollTo(offset: number): void;
  focus(): void;
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
