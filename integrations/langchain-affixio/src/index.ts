// @ts-ignore LangChain supplies these peer modules at consumer install time.
import { ToolMessage } from "@langchain/core/messages";
// @ts-ignore LangChain supplies these peer modules at consumer install time.
import { createMiddleware } from "langchain";

export type AffixioAction = {
  toolName: string;
  toolCallId: string;
  args: unknown;
  context: unknown;
};

export type AffixioDecision = {
  allow: boolean;
  proof?: unknown;
  reason?: string;
  metadata?: Record<string, unknown>;
};

export type AffixioAuthorizer = (
  action: AffixioAction
) => Promise<AffixioDecision>;

export type AffixioMiddlewareOptions = {
  authorize: AffixioAuthorizer;
  protectedTools?: readonly string[];
  onDecision?: (action: AffixioAction, decision: AffixioDecision) => void;
};

function isDecision(value: unknown): value is AffixioDecision {
  return typeof value === "object" && value !== null && typeof (value as { allow?: unknown }).allow === "boolean";
}

function denied(request: { toolCall: { id?: string } }, reason: string): ToolMessage {
  return new ToolMessage({
    content: `AffixIO denied tool execution: ${reason}`,
    tool_call_id: request.toolCall.id ?? "unknown",
    status: "error",
  });
}

export function createAffixioMiddleware(options: AffixioMiddlewareOptions) {
  const protectedTools = options.protectedTools ? new Set(options.protectedTools) : undefined;
  return createMiddleware({
    name: "AffixIOAuthorization",
    wrapToolCall: async (request: any, handler: any) => {
      const toolName = request.toolCall.name;
      if (protectedTools && !protectedTools.has(toolName)) return handler(request);

      const action: AffixioAction = {
        toolName,
        toolCallId: request.toolCall.id ?? "unknown",
        args: request.toolCall.args,
        context: request.runtime.context,
      };

      let decision: unknown;
      try {
        decision = await options.authorize(action);
      } catch (error) {
        options.onDecision?.(action, { allow: false, reason: "authorization failure" });
        return denied(request, error instanceof Error ? error.message : "authorization failure");
      }
      if (!isDecision(decision)) {
        options.onDecision?.(action, { allow: false, reason: "malformed decision" });
        return denied(request, "malformed decision");
      }
      options.onDecision?.(action, decision);
      if (!decision.allow) return denied(request, decision.reason ?? "policy denied the action");
      return handler(request);
    },
  });
}

export function createAffixioAuthorizer(
  verify: (action: AffixioAction) => Promise<AffixioDecision>
): AffixioAuthorizer {
  return async (action) => {
    const result = await verify(action);
    if (!isDecision(result)) throw new Error("AffixIO returned a malformed decision");
    return result;
  };
}

/**
 * Adapts the documented AffixSDK.proveAndVerify method without inventing a
 * circuit or policy. The caller supplies the exact SDK input for its policy.
 */
export function createAffixioSdkAuthorizer<TSdk extends {
  proveAndVerify(input: unknown): Promise<{ prove: { decision?: "yes" | "no" }; verify: { valid?: boolean; verified?: boolean } }>;
}>(
  sdk: TSdk,
  buildInput: (action: AffixioAction) => unknown
): AffixioAuthorizer {
  return async (action) => {
    const result = await sdk.proveAndVerify(buildInput(action));
    const valid = result.verify.valid === true && result.verify.verified === true;
    const allow = valid && result.prove.decision === "yes";
    return { allow, proof: result, reason: allow ? undefined : "AffixIO proof verification failed" };
  };
}

/**
 * Creates a local fail-closed authorizer from the documented SDK prove and
 * verifyLocal methods. This path does not require a live API round trip.
 */
export function createAffixioLocalAuthorizer<TSdk extends {
  prove(input: unknown): Promise<{ proof_hex?: string; proof?: string; envelope?: unknown; decision?: "yes" | "no" }>;
  verifyLocal(circuitId: string, proof: string, options?: { envelope?: unknown }): Promise<{ valid?: boolean; verified?: boolean; decision?: "yes" | "no" }>;
}>(
  sdk: TSdk,
  buildInput: (action: AffixioAction) => { circuitId: string; [key: string]: unknown }
): AffixioAuthorizer {
  return async (action) => {
    const input = buildInput(action);
    const proved = await sdk.prove(input);
    const proof = proved.proof_hex ?? proved.proof;
    if (!proof) throw new Error("AffixIO did not return a proof");
    const verified = await sdk.verifyLocal(input.circuitId, proof, { envelope: proved.envelope });
    const allow = verified.valid === true && verified.verified === true && verified.decision === "yes";
    return { allow, proof: { proved, verified }, reason: allow ? undefined : "local proof verification failed" };
  };
}

export { createAffixioMcpGate } from "./mcp.js";
export type { McpGateInput, McpGateResult } from "./mcp.js";
