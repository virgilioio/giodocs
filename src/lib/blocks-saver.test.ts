import { describe, it, expect } from "vitest";
import { createBlocksSaver } from "./blocks-saver";

// A tiny controllable timer so we can advance debounce windows.
function makeFakeTimer() {
  let handles = 0;
  const scheduled = new Map<number, { fn: () => void; at: number }>();
  let now = 0;
  return {
    setTimer: (fn: () => void, ms: number) => {
      const id = ++handles;
      scheduled.set(id, { fn, at: now + ms });
      return id;
    },
    clearTimer: (h: unknown) => {
      scheduled.delete(h as number);
    },
    advance: (ms: number) => {
      now += ms;
      // Copy so mutations during firing don't skip entries.
      const due = [...scheduled.entries()]
        .filter(([, s]) => s.at <= now)
        .sort((a, b) => a[1].at - b[1].at);
      for (const [id, s] of due) {
        scheduled.delete(id);
        s.fn();
      }
    },
  };
}

// A controllable async send() we can resolve on demand.
function makeControllableSend<T>() {
  const calls: T[] = [];
  const pending: Array<{ resolve: () => void; reject: (e: unknown) => void }> =
    [];
  return {
    calls,
    send: (v: T) =>
      new Promise<void>((resolve, reject) => {
        calls.push(v);
        pending.push({ resolve, reject });
      }),
    resolveNext: async () => {
      const p = pending.shift();
      if (!p) throw new Error("no pending send to resolve");
      p.resolve();
      // Let microtasks flush.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    },
    pendingCount: () => pending.length,
  };
}

describe("createBlocksSaver", () => {
  it("flush receives the LATEST value when set() is called three times inside one debounce window", async () => {
    const timer = makeFakeTimer();
    const ctl = makeControllableSend<{ text: string }>();
    const saver = createBlocksSaver<{ text: string }>({
      debounceMs: 500,
      send: ctl.send,
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
    });

    saver.set({ text: "a" });
    saver.set({ text: "as" });
    saver.set({ text: "asd" });

    // Debounce fires exactly one send with the third value.
    timer.advance(500);
    await Promise.resolve();
    expect(ctl.calls).toEqual([{ text: "asd" }]);

    await ctl.resolveNext();
    expect(ctl.pendingCount()).toBe(0);
    // No further sends without new input.
    timer.advance(1000);
    expect(ctl.calls.length).toBe(1);
  });

  it("a change during an in-flight save triggers a follow-up save with the newest value", async () => {
    const timer = makeFakeTimer();
    const ctl = makeControllableSend<{ text: string }>();
    const saver = createBlocksSaver<{ text: string }>({
      debounceMs: 500,
      send: ctl.send,
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
    });

    // First keystroke → debounce → in-flight send.
    saver.set({ text: "a" });
    timer.advance(500);
    await Promise.resolve();
    expect(ctl.calls).toEqual([{ text: "a" }]);
    expect(saver.isSending()).toBe(true);

    // While the first send is in flight, user keeps typing.
    saver.set({ text: "ab" });
    saver.set({ text: "abc" });

    // Resolve the first send. The saver must follow up with the latest.
    await ctl.resolveNext();
    // Follow-up send fires with the newest value.
    expect(ctl.calls).toEqual([{ text: "a" }, { text: "abc" }]);
    await ctl.resolveNext();
    expect(ctl.pendingCount()).toBe(0);
  });

  it("flush() forces immediate send outside the debounce window", async () => {
    const timer = makeFakeTimer();
    const ctl = makeControllableSend<{ text: string }>();
    const saver = createBlocksSaver<{ text: string }>({
      debounceMs: 500,
      send: ctl.send,
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
    });

    saver.set({ text: "hi" });
    // Do NOT advance timer — simulate blur/route change 100ms in.
    const flushed = saver.flush();
    await Promise.resolve();
    expect(ctl.calls).toEqual([{ text: "hi" }]);
    await ctl.resolveNext();
    await flushed;
  });

  it("markSaved prevents a redundant send when the value matches the server", async () => {
    const timer = makeFakeTimer();
    const ctl = makeControllableSend<{ text: string }>();
    const saver = createBlocksSaver<{ text: string }>({
      debounceMs: 500,
      send: ctl.send,
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
    });

    saver.markSaved({ text: "abc" });
    saver.set({ text: "abc" });
    timer.advance(500);
    await Promise.resolve();
    expect(ctl.calls).toEqual([]);
  });
});
