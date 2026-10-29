declare module "bs58" {
  interface Bs58 {
    encode(source: Uint8Array): string;
    decode(value: string): Uint8Array;
  }
  const bs58: Bs58;
  export default bs58;
}

declare module "snarkjs" {
  export interface Groth16Proof {
    pi_a: string[];
    pi_b: string[][];
    pi_c: string[];
    protocol: string;
    curve: string;
  }

  export const groth16: {
    fullProve(
      input: Record<string, string | string[]>,
      wasmFile: string,
      zkeyFileName: string,
    ): Promise<{ proof: Groth16Proof; publicSignals: string[] }>;
    verify(verificationKey: object, publicSignals: string[], proof: Groth16Proof): Promise<boolean>;
  };
}
