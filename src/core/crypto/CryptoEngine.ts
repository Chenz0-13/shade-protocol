import { buildPoseidon } from "circomlibjs";
import { groth16 } from "snarkjs";
import { randomBytes, createCipheriv, createDecipheriv } from "crypto";
import { ShieldedNote } from "./primitives.js";

export class CryptoEngine {
  private poseidon: any;

  async init(): Promise<void> {
    this.poseidon = await buildPoseidon();
  }

  generateStealthAddress(recipientPubKey: Uint8Array): {
    stealthAddress: Uint8Array;
    ephemeralKey: Uint8Array;
  } {
    const ephemeralKey = randomBytes(32);
    const sharedSecret = this.poseidon([
      BigInt("0x" + Buffer.from(ephemeralKey).toString("hex")),
      BigInt("0x" + Buffer.from(recipientPubKey).toString("hex")),
    ]);

    const stealthAddress = new Uint8Array(
      Buffer.from(sharedSecret.toString(16).padStart(64, "0"), "hex")
    );

    return { stealthAddress, ephemeralKey };
  }

  async buildNote(
    amount: bigint,
    recipientPubKey: Uint8Array,
    secret: Uint8Array
  ): Promise<ShieldedNote> {
    const { stealthAddress } = this.generateStealthAddress(recipientPubKey);

    const commitment = this.poseidon([
      amount,
      BigInt("0x" + Buffer.from(secret).toString("hex")),
      BigInt("0x" + Buffer.from(recipientPubKey).toString("hex")),
    ]);

    const nullifier = this.poseidon([
      BigInt("0x" + Buffer.from(secret).toString("hex")),
      commitment,
    ]);

    const iv = randomBytes(12);
    const key = Buffer.from(secret).slice(0, 32);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encryptedValue = Buffer.concat([
      iv,
      cipher.update(Buffer.from(amount.toString())),
      cipher.final(),
      cipher.getAuthTag(),
    ]);

    return {
      commitment,
      nullifier,
      encryptedValue,
      stealthAddress: Buffer.from(stealthAddress).toString("hex"),
    };
  }

  async verifyProof(
    proof: object,
    publicSignals: string[],
    verificationKey: object
  ): Promise<boolean> {
    return groth16.verify(verificationKey, publicSignals, proof);
  }

  decryptNote(encryptedValue: Buffer, viewKey: Uint8Array): bigint {
    const iv = encryptedValue.slice(0, 12);
    const tag = encryptedValue.slice(-16);
    const data = encryptedValue.slice(12, -16);
    const key = Buffer.from(viewKey).slice(0, 32);

    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return BigInt(decrypted.toString());
  }
}
