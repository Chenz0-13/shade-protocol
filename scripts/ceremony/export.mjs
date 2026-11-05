import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { arg, ceremonyRoot, ensureWork, refuseLiveCeremony, sha256Text, snark, zkeyDir } from "./lib.mjs";

refuseLiveCeremony();
ensureWork();
const circuit = arg("--circuit", "shielded_transfer");
const zkey = path.join(zkeyDir, `${circuit}_final.zkey`);
const outDir = path.join(ceremonyRoot, "circuits", "ceremony", "published");
mkdirSync(outDir, { recursive: true });
const vkeyPath = path.join(outDir, `${circuit}.verification_key.json`);
const solPath = path.join(outDir, `${circuit}.verifier.sol`);
await snark("zkey", "export", "verificationkey", zkey, vkeyPath);
await snark("zkey", "export", "solidityverifier", zkey, solPath);
const vkey = readFileSync(vkeyPath, "utf8");
const record = {
  circuit,
  ceremony: "not-started",
  warning: "Development export only if you forced the tooling. Circuits are not frozen and this is not a ceremony transcript.",
  vkeySha256: sha256Text(vkey),
  soliditySha256: sha256Text(readFileSync(solPath, "utf8")),
};
writeFileSync(path.join(outDir, `${circuit}.vkey-hash.json`), `${JSON.stringify(record, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(record)}\n`);
