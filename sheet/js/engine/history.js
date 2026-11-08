// Undo / redo.
//
// Cell-level operations (typing, paste, fill, format, sort, clear, column widths) are
// recorded as before/after patches of only the touched cells. Operations that rewrite
// formulas all over the workbook (insert/delete rows, cut & paste, sheet changes)
// store whole-workbook snapshots instead — simpler and always exact.

export class History {
  constructor(wb, { limit = 200 } = {}) {
    this.wb = wb;
    this.limit = limit;
    this.undoStack = [];
    this.redoStack = [];
  }

  // fn runs the change. meta is kept with the entry and handed back on undo/redo
  // (the UI stores its selection there). Returns fn's result.
  run(label, fn, { snapshot = false, meta = null } = {}) {
    let entry;
    let result;
    if (snapshot) {
      const before = this.wb.toJSON();
      result = fn();
      entry = { label, type: 'snapshot', before, after: this.wb.toJSON(), meta };
    } else {
      this.wb.beginRecording();
      try {
        result = fn();
      } finally {
        const patch = this.wb.endRecording();
        if (patch) entry = { label, type: 'patch', patch, meta };
      }
    }
    if (entry) {
      this.undoStack.push(entry);
      if (this.undoStack.length > this.limit) this.undoStack.shift();
      this.redoStack = [];
    }
    return result;
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  get undoLabel() { return this.undoStack[this.undoStack.length - 1]?.label ?? null; }
  get redoLabel() { return this.redoStack[this.redoStack.length - 1]?.label ?? null; }

  undo() {
    const e = this.undoStack.pop();
    if (!e) return null;
    this._apply(e, 'before');
    this.redoStack.push(e);
    return e;
  }

  redo() {
    const e = this.redoStack.pop();
    if (!e) return null;
    this._apply(e, 'after');
    this.undoStack.push(e);
    return e;
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }

  _apply(e, side) {
    if (e.type === 'snapshot') this.wb.load(e[side]);
    else this.wb.applyPatch(e.patch, side);
  }
}
