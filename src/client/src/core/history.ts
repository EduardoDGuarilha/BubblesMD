interface Entry<T> {
  state: T;
  group?: string;
  at: number;
}

const GROUP_WINDOW_MS = 1500;
const LIMIT = 300;

/**
 * Linear snapshot history. Each entry stores the complete tracked state *before* a change, so undo restores
 * document text and review state together. Consecutive changes with the same group key (typing) merge.
 */
export class History<T> {
  private undoStack: Entry<T>[] = [];
  private redoStack: T[] = [];

  record(before: T, group?: string, now = Date.now()): void {
    const top = this.undoStack[this.undoStack.length - 1];
    this.redoStack = [];
    if (group && top && top.group === group && now - top.at < GROUP_WINDOW_MS) {
      top.at = now;
      return;
    }
    this.undoStack.push({ state: before, group, at: now });
    if (this.undoStack.length > LIMIT) this.undoStack.shift();
  }

  /** Close the current typing group so the next edit starts a new entry. */
  breakGroup(): void {
    const top = this.undoStack[this.undoStack.length - 1];
    if (top) top.group = undefined;
  }

  undo(current: T): T | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.redoStack.push(current);
    return entry.state;
  }

  redo(current: T): T | null {
    const next = this.redoStack.pop();
    if (next === undefined) return null;
    this.undoStack.push({ state: current, at: 0 });
    return next;
  }

  /** Drop the newest entry if it is exactly `state` (used to cancel an empty, never-used review). */
  dropIfTop(state: T): boolean {
    const top = this.undoStack[this.undoStack.length - 1];
    if (top && top.state === state) {
      this.undoStack.pop();
      return true;
    }
    return false;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
