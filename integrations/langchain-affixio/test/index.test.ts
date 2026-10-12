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
});
