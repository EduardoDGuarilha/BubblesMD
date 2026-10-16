interface Entry<T> {
  state: T;
  label: string;
  group?: string;
  /** Set when the entry was recorded by a reflection submission, so its resulting suggestion can join it. */
  submission?: string;
  at: number;
}

export interface RecordOptions {
  label: string;
  group?: string;
  submission?: string;
}

const GROUP_WINDOW_MS = 1500;
const LIMIT = 300;

/**
 * Linear snapshot history. Each entry stores the complete tracked state *before* a change, so undo restores
 * document text and review state together. Consecutive changes with the same group key (typing) merge.
 * `mutation` changes on every record, undo and redo: a pending merge is only valid while it is unchanged.
 */
export class History<T> {
  private undoStack: Entry<T>[] = [];
  private redoStack: { state: T; label: string }[] = [];
  private counter = 0;

  record(before: T, opts: RecordOptions, now = Date.now()): void {
    const top = this.undoStack[this.undoStack.length - 1];
    this.redoStack = [];
    this.counter++;
    if (opts.group && top && top.group === opts.group && now - top.at < GROUP_WINDOW_MS) {
      top.at = now;
      return;
    }
    this.undoStack.push({ state: before, label: opts.label, group: opts.group, submission: opts.submission, at: now });
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
    this.counter++;
    this.redoStack.push({ state: current, label: entry.label });
    return entry.state;
  }

  redo(current: T): T | null {
    const next = this.redoStack.pop();
    if (next === undefined) return null;
    this.counter++;
    this.undoStack.push({ state: current, label: next.label, at: 0 });
    return next.state;
  }

  get mutation(): number {
    return this.counter;
  }

  /** True when the newest entry was recorded by this submission and nothing has been recorded or undone since. */
  canMerge(submission: string, mutation: number): boolean {
    const top = this.undoStack[this.undoStack.length - 1];
    return !!top && top.submission === submission && this.counter === mutation;
  }

  /** Labels of the undo stack, oldest first (inspection and tests). */
  describe(): string[] {
    return this.undoStack.map((e) => e.label);
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
    this.counter++;
  }
}
