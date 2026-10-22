// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createState, type UiActions } from "../../src/client/core/state.ts";
import { activateWorkspace, refresh } from "../../src/client/float/panel.ts";

const actions = { refresh: async () => true } as UiActions;
afterEach(() => { vi.unstubAllGlobals(); document.body.textContent = ""; });

describe("workspace status snapshots", () => {
  it("a late A response cannot overwrite B, and B does not wait for A's request", async () => {
    const pending = new Map<string, (value: unknown) => void>();
    vi.stubGlobal("fetch", vi.fn((url: string) => new Promise(resolve => pending.set(url, resolve))));
    const state = createState();
    state.sessionResolved = true;
    state.currentCwd = "/a";
    const a = refresh(state, actions);
    state.currentCwd = "/b";
    activateWorkspace(state, actions, "/a");
    const b = refresh(state, actions);
    const response = (connected: number) => ({ ok: true, json: async () => ({ servers: [], counts: { connected } }) });
    pending.get(`${state.API.servers}?cwd=%2Fb`)!(response(2));
    await b;
    expect(state.counts.connected).toBe(2);
    pending.get(`${state.API.servers}?cwd=%2Fa`)!(response(9));
    await a;
    expect(state.counts.connected).toBe(2);
  });

  it("switching shows the target snapshot immediately and clears the old workspace on a cold target", () => {
    const state = createState();
    state.sessionResolved = true;
    state.currentCwd = "/a";
    state.counts = { connected: 9 };
    state.currentCwd = "/b";
    activateWorkspace(state, actions, "/a");
    expect(state.counts).toEqual({});
    state.counts = { connected: 2 };
    state.currentCwd = "/a";
    activateWorkspace(state, actions, "/b");
    expect(state.counts.connected).toBe(9);
    state.currentCwd = "/b";
    activateWorkspace(state, actions, "/a");
    expect(state.counts.connected).toBe(2);
  });
});
