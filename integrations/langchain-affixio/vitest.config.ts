import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      langchain: resolve(__dirname, "test/langchain-shim.ts"),
      "@langchain/core/messages": resolve(__dirname, "test/core-shim.ts"),
    },
  },
  test: { environment: "node" },
});
