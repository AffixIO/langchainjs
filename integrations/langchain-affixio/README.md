# `@affixio/langchain-authorization`

Optional execution-boundary authorization middleware for LangChain.js. This is an independent AffixIO integration, not an official LangChain or OpenAI integration.

## Flow

`LangChain agent -> wrapToolCall -> AffixIO decision -> ALLOW/DENY -> tool`

For MCP servers, add the existing SDK gate at the server boundary as well:

```ts
import { AffixSDK, spendingPolicy } from "affixio";
import { createAffixioMcpGate } from "@affixio/langchain-authorization";

const gate = createAffixioMcpGate({
  sdk: new AffixSDK({ apiKey: process.env.AFFIXIO_API_KEY! }),
  policy: spendingPolicy({ currency: "GBP", maxPerAction: 100 }),
  action: "mcp_tool_call",
  amount: 0,
  currency: "GBP",
  mode: "online",
});

await gate("refund_order");
await server.callTool("refund_order", args);
```

The MCP call must not proceed if `gate()` throws. This produces a defense-in-depth flow: LangChain middleware protects the agent runtime, and the MCP gate protects the server-side tool boundary.

The middleware awaits the decision before calling LangChain's handler. A denial, malformed response, thrown verifier error, timeout, or unavailable verifier returns an error `ToolMessage` and never invokes the protected tool. Tools not selected by `protectedTools` retain normal behavior.

## Usage

```ts
import { createAgent } from "langchain";
import { createAffixioMiddleware } from "@affixio/langchain-authorization";

const middleware = createAffixioMiddleware({
  protectedTools: ["buy_item"],
  authorize: async ({ toolName, toolCallId, args, context }) => {
    // Call the documented AffixIO 2.0.4 SDK/API here. Keep this function
    // responsible for returning the verified decision and proof metadata.
    return affixio.verify({ toolName, toolCallId, args, context });
  },
});

const agent = createAgent({ model, tools: [buyItem], middleware: [middleware] });
```

For the documented SDK proof path, pass an `AffixSDK` instance and a policy-specific input builder to `createAffixioSdkAuthorizer`. It calls the real `sdk.proveAndVerify(input)` method and allows only when both `verify.valid` and `verify.verified` are true and the proof decision is `yes`.

For a local execution boundary, use `createAffixioLocalAuthorizer`. It calls the real `sdk.prove()` and `sdk.verifyLocal()` methods and fails closed if either step fails. Use an ML-DSA or UltraHonk configuration for an untrusted verifier; HMAC verification is for trusted server-side processes only.

```ts
import { AffixSDK } from "affixio";
import { createAffixioSdkAuthorizer } from "@affixio/langchain-authorization";

const sdk = new AffixSDK({ apiKey: process.env.AFFIXIO_API_KEY! });
const authorize = createAffixioSdkAuthorizer(sdk, (action) => ({
  circuitId: "simple_yesno",
  fields: { a: "0x1" },
  policy: { tool: action.toolName, tool_call_id: action.toolCallId },
  mode: "offline",
  origin: "langchain",
}));
```

The package deliberately accepts an authorizer rather than inventing an AffixIO endpoint or response schema. AffixIO 2.0.4 bundles `simple_yesno` and `yesno`; `simple_yesno` is the smallest suitable decision circuit and uses the documented `a` witness field. Server-attested flows should use the API's server-prove and proof-attest sequence for a named circuit. API keys remain with the AffixIO client and are never sent to LangChain tools.

## Scope and limitations

This enforces the LangChain `wrapToolCall` path. Direct calls to a tool object that bypass the agent are outside this middleware and must be guarded separately. Bind the tool name, tool-call ID, arguments digest, principal, policy, and expiry in the AffixIO proof or verifier for replay and tamper resistance. This package does not claim cryptographic verification itself.

New LangChain integrations are documented as standalone packages by LangChain's contribution guide, so this package is intentionally isolated from LangChain core.
