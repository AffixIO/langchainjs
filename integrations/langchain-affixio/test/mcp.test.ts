import { beforeEach, describe, expect, it, vi } from "vitest";

const gateMock = vi.fn();
vi.mock("affixio", () => ({ mcpToolGate: gateMock }));

const { createAffixioMcpGate } = await import("../src/mcp.js");

describe("AffixIO MCP execution boundary", () => {
  beforeEach(() => gateMock.mockReset());

  it("allows only after the SDK gate allows", async () => {
    gateMock.mockResolvedValue({ allowed: true, reason: "ok" });
    const gate = createAffixioMcpGate({ sdk: {} as never, action: "call", amount: 0, currency: "GBP" });
    const result = await gate("read_order");
    expect(result.allowed).toBe(true);
    expect(gateMock).toHaveBeenCalledWith(expect.objectContaining({ tool: "read_order" }));
  });

  it("throws on denial so a caller cannot continue to the MCP tool", async () => {
    gateMock.mockResolvedValue({ allowed: false, reason: "missing approval" });
    const downstream = vi.fn();
    const gate = createAffixioMcpGate({ sdk: {} as never, action: "call", amount: 0, currency: "GBP" });
    await expect(gate("delete_order")).rejects.toThrow("missing approval");
    expect(downstream).not.toHaveBeenCalled();
  });

  it("does not share tool identity between concurrent calls", async () => {
    gateMock.mockImplementation(async ({ tool }: { tool: string } = { tool: "missing" }) => ({ allowed: tool === "safe_tool", reason: tool }));
    const gate = createAffixioMcpGate({ sdk: {} as never, action: "call", amount: 0, currency: "GBP" });
    const results = await Promise.allSettled([gate("safe_tool"), gate("blocked_tool")]);
    expect(results[0].status).toBe("fulfilled");
    expect(results[1].status).toBe("rejected");
    expect(gateMock.mock.calls.map(([input]) => input.tool).sort()).toEqual(["blocked_tool", "safe_tool"]);
  });
});
