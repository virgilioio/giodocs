/**
 * Debounced trailing saver for a single value (used for pages.blocks).
 *
 * Design goals — these are the exact properties the page editor relies on:
 *
 *  1. `set(value)` is called on every keystroke. The value gets stashed in
 *     an internal ref; the saver NEVER captures a value into a closure.
 *  2. A 500ms trailing debounce collapses keystrokes into one send.
 *  3. `flush()` sends now (blur, route change, page unload).
 *  4. Single-flight: at most one `send()` in flight. If `set()` was called
 *     while a send is in flight, exactly one follow-up send fires with the
 *     LATEST value at settle time.
 *  5. `savedRef` is owned here, not by React effects, so it can't be
 *     clobbered by an optimistic cache patch mid-save.
 *
 * The saver has no React dependency; it is unit-tested directly.
 */

export type BlocksSaver<T> = {
  /** Update the latest value and (re)start the debounce timer. */
  set: (value: T) => void;
  /** Fire now if there is unsaved work. Returns a promise that resolves
   *  when any in-flight and any queued follow-up send have finished. */
  flush: () => Promise<void>;
  /** Cancel the pending timer without sending. */
  cancel: () => void;
  /** Overwrite the "saved" marker without sending (e.g. after external
   *  sync). Used when initialising to the server-known blocks. */
  markSaved: (value: T) => void;
  /** True while a send is in flight. */
  isSending: () => boolean;
  /** Tear down timers. Does not flush. */
  dispose: () => void;
};

export type BlocksSaverOptions<T> = {
  debounceMs?: number;
  /** Called to persist a value. Rejections are surfaced to `onError`. */
  send: (value: T) => Promise<void>;
  /** Compare current vs saved to decide whether to send. Defaults to
   *  JSON.stringify equality. */
  equals?: (a: T, b: T) => boolean;
  onError?: (err: unknown) => void;
  /** Timer primitives; overridable for tests. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

const defaultEquals = <T,>(a: T, b: T) =>
  JSON.stringify(a) === JSON.stringify(b);

export function createBlocksSaver<T>(
  opts: BlocksSaverOptions<T>,
): BlocksSaver<T> {
  const debounceMs = opts.debounceMs ?? 500;
  const setTimer =
    opts.setTimer ??
    ((fn: () => void, ms: number) =>
      (globalThis as { setTimeout: typeof setTimeout }).setTimeout(fn, ms));
  const clearTimer =
    opts.clearTimer ??
    ((h: unknown) =>
      (globalThis as { clearTimeout: typeof clearTimeout }).clearTimeout(
        h as ReturnType<typeof setTimeout>,
      ));
  const equals = opts.equals ?? defaultEquals;

  // Refs — mutated in place, never captured by value.
  const state: {
    latest: { value: T } | null;
    saved: { value: T } | null;
    timer: unknown;
    inflight: Promise<void> | null;
    followup: Promise<void> | null;
    disposed: boolean;
  } = {
    latest: null,
    saved: null,
    timer: null,
    inflight: null,
    followup: null,
    disposed: false,
  };

  function clear() {
    if (state.timer != null) {
      clearTimer(state.timer);
      state.timer = null;
    }
  }

  async function doSend(): Promise<void> {
    if (state.disposed) return;
    if (!state.latest) return;
    if (state.saved && equals(state.latest.value, state.saved.value)) return;

    // Snapshot the value to send; latest may change during the await.
    const snapshot = state.latest.value;
    const p = (async () => {
      try {
        await opts.send(snapshot);
        state.saved = { value: snapshot };
      } catch (err) {
        opts.onError?.(err);
      }
    })();
    state.inflight = p;

    try {
      await p;
    } finally {
      state.inflight = null;
    }

    // Follow-up: if latest advanced past what we just saved, send again.
    if (
      !state.disposed &&
      state.latest &&
      (!state.saved || !equals(state.latest.value, state.saved.value))
    ) {
      state.followup = doSend();
      try {
        await state.followup;
      } finally {
        state.followup = null;
      }
    }
  }

  function schedule() {
    clear();
    state.timer = setTimer(() => {
      state.timer = null;
      // Fire and forget; callers waiting for completion use flush().
      void doSend();
    }, debounceMs);
  }

  return {
    set(value) {
      if (state.disposed) return;
      state.latest = { value };
      schedule();
    },
    async flush() {
      if (state.disposed) return;
      clear();
      // If nothing to send, still await any in-flight work.
      if (!state.latest) {
        if (state.inflight) await state.inflight;
        return;
      }
      if (state.inflight) {
        // A send is already running; its follow-up path will pick up the
        // newer `latest`. Wait for both.
        await state.inflight;
        if (state.followup) await state.followup;
        // If more edits arrived after both settled, one more pass.
        if (
          state.latest &&
          (!state.saved || !equals(state.latest.value, state.saved.value))
        ) {
          await doSend();
        }
        return;
      }
      await doSend();
    },
    cancel() {
      clear();
    },
    markSaved(value) {
      state.saved = { value };
    },
    isSending() {
      return state.inflight != null;
    },
    dispose() {
      state.disposed = true;
      clear();
    },
  };
}
