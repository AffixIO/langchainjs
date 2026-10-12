import { mcpToolGate } from "affixio";

export type McpGateInput = Parameters<typeof mcpToolGate>[0];
export type McpGateResult = Awaited<ReturnType<typeof mcpToolGate>>;

/**
 * Wraps the published AffixIO MCP gate for an MCP server-side boundary.
 * The returned function must be awaited before invoking the MCP tool.
 */
export function createAffixioMcpGate(base: Omit<McpGateInput, "tool">): (tool: string, input?: Omit<McpGateInput, "tool">) => Promise<McpGateResult> {
  return async (tool: string, input: Omit<McpGateInput, "tool"> = base): Promise<McpGateResult> => {
    const result = await mcpToolGate({ ...input, tool });
    if (result.allowed !== true) {
      throw new Error(`AffixIO denied MCP tool '${tool}': ${result.reason}`);
    }
    return result;
  };
}
