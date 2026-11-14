import "../src/polyfill.js";
import { groth16 } from "snarkjs";
import type { Groth16ProofJson } from "../../src/app/instruction.js";

interface ProveRequest {
  witness: Record<string, string | string[]>;
  wasm: Uint8Array;
  zkey: Uint8Array;
  vkey: object;
  publicSignals: string[];
}

interface ProveProgress {
  type: "progress";
  message: string;
}

interface ProveDone {
  type: "done";
  proof: Groth16ProofJson;
  publicSignals: string[];
}

interface ProveFailed {
  type: "error";
  message: string;
}

const SAFE = /^[\w .:%()_-]{1,96}$/;

const logger = {
  info(message: unknown): void {
    report(message);
  },
  debug(message: unknown): void {
    report(message);
  },
  warn(message: unknown): void {
    report(message);
  },
  error(message: unknown): void {
    report(message);
  },
};

function report(message: unknown): void {
  const text = String(message);
  if (!SAFE.test(text)) return;
  const progress: ProveProgress = { type: "progress", message: text };
  self.postMessage(progress);
}

self.onmessage = (event: MessageEvent<ProveRequest>) => {
  void prove(event.data);
};

async function prove(request: ProveRequest): Promise<void> {
  try {
    const proved = await groth16.fullProve(request.witness, request.wasm, request.zkey, logger);
    if (proved.publicSignals.join(",") !== request.publicSignals.join(",")) {
      throw new Error("The proof did not match this note.");
    }
    const ok = await groth16.verify(request.vkey, proved.publicSignals, proved.proof);
    if (!ok) throw new Error("The proof did not check on this device.");
    const done: ProveDone = {
      type: "done",
      proof: {
        pi_a: proved.proof.pi_a,
        pi_b: proved.proof.pi_b,
        pi_c: proved.proof.pi_c,
      },
      publicSignals: proved.publicSignals,
    };
    self.postMessage(done);
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] ?? "The proof failed." : "The proof failed.";
    const failed: ProveFailed = { type: "error", message: message.slice(0, 220) };
    self.postMessage(failed);
  }
}
