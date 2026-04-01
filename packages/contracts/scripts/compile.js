import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import solc from "solc";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");

const contractPath = resolve(rootDir, "src/ERC20Token.sol");
const contractSource = readFileSync(contractPath, "utf-8");

/** @param {string} importPath */
function findImports(importPath) {
  try {
    const resolved = resolve(rootDir, "node_modules", importPath);
    return { contents: readFileSync(resolved, "utf-8") };
  } catch {
    return { error: `File not found: ${importPath}` };
  }
}

const input = {
  language: "Solidity",
  sources: {
    "ERC20Token.sol": { content: contractSource },
  },
  settings: {
    outputSelection: {
      "*": {
        "*": ["abi", "evm.bytecode.object"],
      },
    },
    optimizer: {
      enabled: true,
      runs: 200,
    },
  },
};

const output = JSON.parse(
  solc.compile(JSON.stringify(input), { import: findImports })
);

if (output.errors) {
  const errors = output.errors.filter(
    (/** @type {{ severity: string }} */ e) => e.severity === "error"
  );
  if (errors.length > 0) {
    console.error("Compilation errors:");
    for (const err of errors) {
      console.error(err.formattedMessage);
    }
    process.exit(1);
  }
}

const contract = output.contracts["ERC20Token.sol"]["ERC20Token"];
const artifact = {
  abi: contract.abi,
  bytecode: `0x${contract.evm.bytecode.object}`,
};

const artifactsDir = resolve(rootDir, "artifacts");
mkdirSync(artifactsDir, { recursive: true });
writeFileSync(
  resolve(artifactsDir, "ERC20Token.json"),
  JSON.stringify(artifact, null, 2)
);

console.log("Compiled ERC20Token.sol -> artifacts/ERC20Token.json");
