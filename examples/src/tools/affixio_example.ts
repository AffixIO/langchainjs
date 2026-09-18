import { AffixIOAttestationTool } from "../../../libs/langchain-community/src/tools/affixio.js";

async function run() {
  const tool = new AffixIOAttestationTool();
  const out = await tool.invoke("payments.transfer");
  console.log(out);
}

run();
