import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAffixioMiddleware } from "../src/index.js";

function request(name: string, args: unknown) {
  return {
    toolCall: { id: "call-1", name, args },
    tool: undefined,
    state: {},
    runtime: { context: { tenant: "test" } },
  } as never;
}

const handler = vi.fn(async () => ({ type: "tool", content: "done", tool_call_id: "call-1" }));

describe("AffixIO LangChain execution boundary", () => {
  beforeEach(() => handler.mockClear());
  it("allows exactly once and preserves the request", async () => {
    const args = { amount: 42.35 };
    const authorize = vi.fn(async (action) => ({ allow: true, proof: { id: "p1" }, metadata: { action } }));
    const middleware = createAffixioMiddleware({ authorize });
    const result = await middleware.wrapToolCall!(request("checkout", args), handler as never);
    expect(result).toEqual({ type: "tool", content: "done", tool_call_id: "call-1" });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(authorize.mock.calls[0][0]).toMatchObject({ toolName: "checkout", args });
  });

  it("denies without executing", async () => {
    const authorize = vi.fn(async () => ({ allow: false, reason: "budget" }));
    const middleware = createAffixioMiddleware({ authorize });
    const result = await middleware.wrapToolCall!(request("checkout", { amount: 423.5 }), handler as never);
    expect(handler).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "error" });
  });

  it.each(["throws", "malformed"]) ("fails closed when authorization %s", async (mode) => {
    const authorize = mode === "throws"
      ? vi.fn(async () => { throw new Error("offline"); })
      : vi.fn(async () => ({ allow: "yes" } as never));
    const middleware = createAffixioMiddleware({ authorize });
    await middleware.wrapToolCall!(request("pay", { amount: 1 }), handler as never);
    expect(handler).not.toHaveBeenCalled();
  });

  it("does not protect unlisted tools", async () => {
    const authorize = vi.fn(async () => ({ allow: false }));
    const middleware = createAffixioMiddleware({ authorize, protectedTools: ["pay"] });
    await middleware.wrapToolCall!(request("read_catalogue", {}), handler as never);
    expect(authorize).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("supports async authorization and records decisions", async () => {
    const onDecision = vi.fn();
    const middleware = createAffixioMiddleware({
      authorize: async () => { await new Promise((resolve) => setTimeout(resolve, 5)); return { allow: true }; },
      onDecision,
    });
    await middleware.wrapToolCall!(request("ship", { sku: "x" }), handler as never);
    expect(onDecision).toHaveBeenCalledWith(expect.objectContaining({ toolName: "ship" }), { allow: true });
  });

  it("passes the exact arguments to authorization before execution", async () => {
    const args = Object.freeze({ amount: 42.35, recipient: "merchant-a" });
    const authorize = vi.fn(async (action) => ({
      allow: action.args === args,
      proof: { actionDigest: "bound-to-exact-object" },
    }));
    const middleware = createAffixioMiddleware({ authorize });
    await middleware.wrapToolCall!(request("pay", args), handler as never);
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ args }));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("isolates concurrent decisions and blocks the denied call", async () => {
    const calls: string[] = [];
    const authorize = vi.fn(async (action) => {
      await new Promise((resolve) => setTimeout(resolve, action.args === "deny" ? 10 : 1));
      calls.push(String(action.args));
      return { allow: action.args !== "deny" };
    });
    const middleware = createAffixioMiddleware({ authorize });
    const allowed = vi.fn(async () => ({ type: "tool", content: "allowed", tool_call_id: "a" }));
    const deniedHandler = vi.fn(async () => ({ type: "tool", content: "denied", tool_call_id: "b" }));
    await Promise.all([
      middleware.wrapToolCall!(request("pay", "allow"), allowed as never),
      middleware.wrapToolCall!(request("pay", "deny"), deniedHandler as never),
    ]);
    expect(calls.sort()).toEqual(["allow", "deny"]);
    expect(allowed).toHaveBeenCalledTimes(1);
    expect(deniedHandler).not.toHaveBeenCalled();
  });

  it("fails closed for a verifier that returns a proof without a decision", async () => {
    const authorize = vi.fn(async () => ({ proof: { valid: true } } as never));
    const middleware = createAffixioMiddleware({ authorize });
    await middleware.wrapToolCall!(request("delete", { id: "record-1" }), handler as never);
    expect(handler).not.toHaveBeenCalled();
  });

  it("never starts the handler before the decision promise resolves", async () => {
    let release!: (value: { allow: boolean }) => void;
    let decided = false;
    const authorize = vi.fn(() => new Promise<{ allow: boolean }>((resolve) => { release = resolve; }));
    const guardedHandler = vi.fn(async () => {
      expect(decided).toBe(true);
      return { type: "tool", content: "ok", tool_call_id: "call-1" };
    });
    const middleware = createAffixioMiddleware({ authorize });
    const pending = middleware.wrapToolCall!(request("pay", { amount: 1 }), guardedHandler as never);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(guardedHandler).not.toHaveBeenCalled();
    decided = true;
    release({ allow: true });
    await pending;
    expect(guardedHandler).toHaveBeenCalledTimes(1);
  });

  it("does not execute twice when the handler rejects", async () => {
    const guardedHandler = vi.fn(async () => { throw new Error("tool failure"); });
    const middleware = createAffixioMiddleware({ authorize: async () => ({ allow: true }) });
    await expect(middleware.wrapToolCall!(request("charge", { amount: 10 }), guardedHandler as never)).rejects.toThrow("tool failure");
    expect(guardedHandler).toHaveBeenCalledTimes(1);
  });

  it("keeps protected and unprotected calls independent", async () => {
    const authorize = vi.fn(async (action) => ({ allow: action.toolName === "read" }));
    const middleware = createAffixioMiddleware({ authorize, protectedTools: ["pay", "delete"] });
    const readHandler = vi.fn(async () => ({ type: "tool", content: "read", tool_call_id: "r" }));
    const payHandler = vi.fn(async () => ({ type: "tool", content: "pay", tool_call_id: "p" }));
    await middleware.wrapToolCall!(request("read", {}), readHandler as never);
    await middleware.wrapToolCall!(request("pay", {}), payHandler as never);
    expect(readHandler).toHaveBeenCalledTimes(1);
    expect(payHandler).not.toHaveBeenCalled();
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ toolName: "pay" }));
  });
});
