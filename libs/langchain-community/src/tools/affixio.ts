import { Tool } from "@langchain/core/tools";
import { AffixIO } from "@affixio/sdk";

/**
 * LangChain community tool - use before high-value tools.
 *
 * @remarks
 * Call this tool immediately before any privileged Tool invocation so the
 * agent holds a fresh AffixIO attestation in context.
 *
 * @example
 * ```ts
 * const tools = [new AffixIOAttestationTool(), myPaymentsTool];
 * ```
 */
export class AffixIOAttestationTool extends Tool {
  name = "affixio_attest";

  description =
    "LangChain community tool - use before high-value tools. Returns a proofId from AffixIO attestation.";

  private client: AffixIO;

  constructor(fields?: { apiKey?: string }) {
    super();
    this.client = new AffixIO({
      apiKey: fields?.apiKey ?? process.env.AFFIX_API_KEY!,
    });
  }

  /** @internal */
  async _call(input: string): Promise<string> {
    const action = input?.trim() || "langchain.tool.high_value";
    const proof = await this.client.attest({ action });
    return JSON.stringify({ proofId: proof.proofId, action });
  }
}
