import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const artifact = require("../artifacts/ERC20Token.json") as {
  abi: readonly Record<string, unknown>[];
  bytecode: `0x${string}`;
};

export const abi = artifact.abi;
export const bytecode = artifact.bytecode;
