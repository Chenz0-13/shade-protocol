import { createWriteStream, existsSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { blake2b512, ensureWork, pin, potPath, refuseLiveCeremony } from "./lib.mjs";

refuseLiveCeremony();
ensureWork();

if (!existsSync(potPath)) {
  process.stdout.write(`Downloading ${pin.url}\n`);
  const response = await fetch(pin.url);
  if (!response.ok || !response.body) {
    throw new Error(`download failed: ${response.status}`);
  }
  await pipeline(response.body, createWriteStream(potPath));
}

const digest = blake2b512(potPath);
if (digest !== pin.blake2b512) {
  throw new Error(`ptau hash mismatch.\n got ${digest}\n want ${pin.blake2b512}`);
}
process.stdout.write(`Verified ${pin.name} blake2b512.\n`);
process.stdout.write(`Power 2^${pin.power} covers ${pin.maxConstraints} constraints. Current largest circuit is under that cap. Do not finalise a ceremony until the circuits are frozen.\n`);
