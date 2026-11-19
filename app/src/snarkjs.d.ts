declare module "snarkjs" {
  interface Groth16Proof {
    pi_a: string[];
    pi_b: string[][];
    pi_c: string[];
  }
  interface Logger {
    info?: (message: unknown) => void;
    debug?: (message: unknown) => void;
    warn?: (message: unknown) => void;
    error?: (message: unknown) => void;
  }
  export const groth16: {
    fullProve(
      witness: Record<string, string | string[]>,
      wasm: Uint8Array,
      zkey: Uint8Array,
      logger?: Logger,
    ): Promise<{ proof: Groth16Proof; publicSignals: string[] }>;
    verify(verificationKey: object, publicSignals: string[], proof: Groth16Proof): Promise<boolean>;
  };
}
