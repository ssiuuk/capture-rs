// Saves editor changes in the background. Each scheduled save is a
// snapshot of one capture's document, taken when the change was made, so
// a save never picks up another capture's state when the editor switches
// captures. Saves run one at a time, in order.

export class SaveQueue {
  // `write(snapshot)` stores one snapshot; it handles its own errors.
  constructor(write, delayMs = 600) {
    this.write = write;
    this.delayMs = delayMs;
    this.pending = new Map(); // capture id -> latest unsaved snapshot
    this.chain = Promise.resolve();
    this.timer = 0;
  }

  schedule(snapshot) {
    this.pending.set(snapshot.id, snapshot);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.delayMs);
  }

  // Forgets unsaved changes to a capture, e.g. one being deleted.
  drop(id) {
    this.pending.delete(id);
  }

  // Starts every pending save and resolves once they, and any save
  // already running, have finished.
  flush() {
    clearTimeout(this.timer);
    for (const snapshot of this.pending.values()) {
      this.chain = this.chain.then(() => this.write(snapshot)).catch(() => {});
    }
    this.pending.clear();
    return this.chain;
  }
}
