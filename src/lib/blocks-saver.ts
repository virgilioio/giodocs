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
 *  6. A failed send never retries in a tight loop: it backs off (1s, 2s,
 *     4s … 30s) and reports its status, so the page can say "Not saved"
 *     instead of a toast per attempt. A fatal error (an edit conflict)
 *     stops retrying until `resume()`.
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
  /** True while there is work the server hasn't confirmed (pending timer,
   *  a send in flight, a failed send waiting to retry, or a conflict). */
  hasUnsaved: () => boolean;
  /** Retry now (e.g. the browser came back online). */
  retryNow: () => void;
  /** Clear a fatal stop and send the latest value again. */
  resume: () => void;
  /** Current status. */
  status: () => SaverStatus;
};

/** idle: nothing to save · pending: waiting for the debounce · saving: a send
 *  is in flight · retrying: the last send failed, another is scheduled ·
 *  stopped: a fatal error (conflict); nothing is sent until resume(). */
export type SaverStatus = "idle" | "pending" | "saving" | "retrying" | "stopped";

export type BlocksSaverOptions<T> = {
  debounceMs?: number;
  /** Called to persist a value. Rejections are surfaced to `onError`. */
  send: (value: T) => Promise<void>;
  /** Compare current vs saved to decide whether to send. Defaults to
   *  JSON.stringify equality. */
  equals?: (a: T, b: T) => boolean;
  onError?: (err: unknown) => void;
  /** An error that must not be retried (e.g. an edit conflict). */
  isFatal?: (err: unknown) => boolean;
  /** Called whenever the status changes. */
  onStatus?: (status: SaverStatus) => void;
  /** Backoff after the Nth consecutive failure (1-based), in ms. */
  backoffMs?: (failures: number) => number;
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
  const backoffMs =
    opts.backoffMs ?? ((n: number) => Math.min(30_000, 1000 * 2 ** (n - 1)));

  // Refs — mutated in place, never captured by value.
  const state: {
    latest: { value: T } | null;
    saved: { value: T } | null;
    timer: unknown;
    inflight: Promise<void> | null;
    followup: Promise<void> | null;
    disposed: boolean;
    failures: number;
    stopped: boolean;
    status: SaverStatus;
  } = {
    latest: null,
    saved: null,
    timer: null,
    inflight: null,
    followup: null,
    disposed: false,
    failures: 0,
    stopped: false,
    status: "idle",
  };

  const dirty = () =>
    !!state.latest &&
    (!state.saved || !equals(state.latest.value, state.saved.value));

  function emit() {
    const next: SaverStatus = state.stopped
      ? "stopped"
      : state.inflight
        ? "saving"
        : state.failures > 0 && dirty()
          ? "retrying"
          : dirty()
            ? "pending"
            : "idle";
    if (next === state.status) return;
    state.status = next;
    opts.onStatus?.(next);
  }

  function clear() {
    if (state.timer != null) {
      clearTimer(state.timer);
      state.timer = null;
    }
  }

  async function doSend(): Promise<void> {
    if (state.disposed || state.stopped) return;
    if (!state.latest) return;
    if (state.saved && equals(state.latest.value, state.saved.value)) {
      state.failures = 0;
      emit();
      return;
    }

    // Snapshot the value to send; latest may change during the await.
    const snapshot = state.latest.value;
    let failed = false;
    const p = (async () => {
      try {
        await opts.send(snapshot);
        state.saved = { value: snapshot };
        state.failures = 0;
      } catch (err) {
        failed = true;
        if (opts.isFatal?.(err)) state.stopped = true;
        else state.failures += 1;
        opts.onError?.(err);
      }
    })();
    state.inflight = p;
    emit();

    try {
      await p;
    } finally {
      state.inflight = null;
    }

    if (failed) {
      // Never chain straight into another send after a failure: wait out
      // the backoff (or a resume() after a fatal stop).
      if (!state.disposed && !state.stopped) {
        clear();
        state.timer = setTimer(() => {
          state.timer = null;
          void doSend();
        }, backoffMs(state.failures));
      }
      emit();
      return;
    }

    // Follow-up: if latest advanced past what we just saved, send again.
    if (!state.disposed && dirty()) {
      state.followup = doSend();
      try {
        await state.followup;
      } finally {
        state.followup = null;
      }
    }
    emit();
  }

  function schedule() {
    clear();
    // After a failure, typing doesn't bring the next attempt forward: the
    // retry timer (already running) or the debounce, whichever is later.
    const wait =
      state.failures > 0 ? Math.max(debounceMs, backoffMs(state.failures)) : debounceMs;
    state.timer = setTimer(() => {
      state.timer = null;
      // Fire and forget; callers waiting for completion use flush().
      void doSend();
    }, wait);
  }

  return {
    set(value) {
      if (state.disposed) return;
      state.latest = { value };
      if (state.stopped) {
        emit();
        return;
      }
      // While a retry is already scheduled, keep its timer.
      if (state.failures > 0 && state.timer != null) {
        emit();
        return;
      }
      schedule();
      emit();
    },
    async flush() {
      if (state.disposed || state.stopped) return;
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
      emit();
    },
    isSending() {
      return state.inflight != null;
    },
    dispose() {
      state.disposed = true;
      clear();
    },
    hasUnsaved() {
      return state.stopped || state.inflight != null || dirty();
    },
    retryNow() {
      if (state.disposed || state.stopped || state.inflight) return;
      if (!dirty()) return;
      clear();
      void doSend();
    },
    resume() {
      if (state.disposed) return;
      state.stopped = false;
      state.failures = 0;
      emit();
      clear();
      void doSend();
    },
    status() {
      return state.status;
    },
  };
}
