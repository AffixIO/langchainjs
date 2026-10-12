# `@affixio/langchain-authorization`

Optional execution-boundary authorization middleware for LangChain.js. This is an independent AffixIO integration, not an official LangChain or OpenAI integration.

## Flow

`LangChain agent -> wrapToolCall -> AffixIO decision -> ALLOW/DENY -> tool`

The middleware awaits the decision before calling LangChain's handler. A denial, malformed response, thrown verifier error, timeout, or unavailable verifier returns an error `ToolMessage` and never invokes the protected tool. Tools not selected by `protectedTools` retain normal behavior.

## Usage

```ts
import { createAgent } from "langchain";
import { createAffixioMiddleware } from "@affixio/langchain-authorization";

const middleware = createAffixioMiddleware({
  protectedTools: ["buy_item"],
  authorize: async ({ toolName, toolCallId, args, context }) => {
    // Call the documented AffixIO 2.0.3 SDK/API here. Keep this function
    // responsible for returning the verified decision and proof metadata.
    return affixio.verify({ toolName, toolCallId, args, context });
  },
});

const agent = createAgent({ model, tools: [buyItem], middleware: [middleware] });
```

For the documented SDK proof path, pass an `AffixSDK` instance and a policy-specific input builder to `createAffixioSdkAuthorizer`. It calls the real `sdk.proveAndVerify(input)` method and allows only when both `verify.valid` and `verify.verified` are true and the proof decision is `yes`.

```ts
import { AffixSDK } from "affixio";
import { createAffixioSdkAuthorizer } from "@affixio/langchain-authorization";

const sdk = new AffixSDK({ apiKey: process.env.AFFIXIO_API_KEY! });
const authorize = createAffixioSdkAuthorizer(sdk, (action) => ({
  circuitId: "your-policy-circuit",
  fields: { tool: action.toolName, tool_call_id: action.toolCallId },
  policy: yourPolicy,
  mode: "online",
  origin: "langchain",
}));
```

The package deliberately accepts an authorizer rather than inventing an AffixIO endpoint or response schema. The authorizer can use `AffixSDK.prove`, `AffixSDK.verifyLocal`, attestation verification, a local policy service, or a separately configured API flow supported by the installed AffixIO version. API keys remain with the AffixIO client and are never sent to LangChain tools.

## Scope and limitations

This enforces the LangChain `wrapToolCall` path. Direct calls to a tool object that bypass the agent are outside this middleware and must be guarded separately. Bind the tool name, tool-call ID, arguments digest, principal, policy, and expiry in the AffixIO proof or verifier for replay and tamper resistance. This package does not claim cryptographic verification itself.

New LangChain integrations are documented as standalone packages by LangChain's contribution guide, so this package is intentionally isolated from LangChain core.
