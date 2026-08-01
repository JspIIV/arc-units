/**
 * Compile contracts/ with solc-js into artifacts/.
 *
 * Deliberately no Hardhat/Foundry: one contract does not justify the toolchain,
 * and this keeps the repo installable with a plain `npm install`.
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import solc from "solc";

const SRC = "contracts";
const OUT = "artifacts";

const files = (await readdir(SRC)).filter((f) => f.endsWith(".sol"));
if (files.length === 0) throw new Error(`no .sol files in ${SRC}/`);

const sources = {};
for (const file of files) {
  sources[file] = { content: await readFile(path.join(SRC, file), "utf8") };
}

const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    // Paris keeps the bytecode free of PUSH0, which some RPC tooling around
    // newer chains still mishandles. Nothing here needs a later target.
    evmVersion: "paris",
    outputSelection: {
      "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object", "metadata"] },
    },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));

const errors = (output.errors ?? []).filter((e) => e.severity === "error");
const warnings = (output.errors ?? []).filter((e) => e.severity !== "error");

for (const warning of warnings) console.warn(`warning: ${warning.formattedMessage.trim()}`);
if (errors.length > 0) {
  for (const error of errors) console.error(error.formattedMessage);
  process.exit(1);
}

await mkdir(OUT, { recursive: true });

// Keep the exact input the compiler saw: explorer verification has to replay
// it byte for byte, and any drift in settings produces a bytecode mismatch.
await writeFile(path.join(OUT, "standard-input.json"), `${JSON.stringify(input, null, 2)}\n`);
// Blockscout matches on `vMAJOR.MINOR.PATCH+commit.HASH`; solc.version() adds
// a build suffix (".Emscripten.clang") that no explorer recognises.
const fullVersion = solc.version();
const explorerVersion = `v${fullVersion.match(/^\d+\.\d+\.\d+\+commit\.[0-9a-f]+/)?.[0] ?? fullVersion}`;
await writeFile(
  path.join(OUT, "compiler.json"),
  `${JSON.stringify({ version: fullVersion, explorerVersion }, null, 2)}\n`,
);

for (const [file, contracts] of Object.entries(output.contracts ?? {})) {
  for (const [name, contract] of Object.entries(contracts)) {
    const artifact = {
      contractName: name,
      sourceFile: file,
      compiler: `solc ${solc.version()}`,
      settings: input.settings,
      abi: contract.abi,
      bytecode: `0x${contract.evm.bytecode.object}`,
      deployedBytecode: `0x${contract.evm.deployedBytecode.object}`,
    };
    const target = path.join(OUT, `${name}.json`);
    await writeFile(target, `${JSON.stringify(artifact, null, 2)}\n`);
    const size = contract.evm.deployedBytecode.object.length / 2;
    console.log(`${name}: ${size} bytes deployed -> ${target}`);
  }
}
