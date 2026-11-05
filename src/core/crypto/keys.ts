import { secp256k1 } from "@noble/curves/secp256k1.js";
import { randomNonZeroField } from "./field.js";
import { ownerAddress } from "./note.js";

export interface PrivacyKeys {
  /** ZK spending key. A field element, not a curve scalar. */
  spendingKey: bigint;
  /** Poseidon(domain, spendingKey). Safe to publish. The view key cannot derive it. */
  ownerPub: bigint;
  /** ECDH key used to recognize stealth addresses and decrypt note payloads. */
  viewPrivateKey: Uint8Array;
  viewPublicKey: Uint8Array;
  /** Curve key used only for the one-time stealth point. Distinct from spendingKey. */
  spendPrivateKey: Uint8Array;
  spendPublicKey: Uint8Array;
}

export interface PublicIdentity {
  ownerPub: bigint;
  viewPublicKey: Uint8Array;
  spendPublicKey: Uint8Array;
}

export function generatePrivacyKeys(): PrivacyKeys {
  const spendingKey = randomNonZeroField();
  const viewPrivateKey = secp256k1.utils.randomSecretKey();
  const spendPrivateKey = secp256k1.utils.randomSecretKey();
  return {
    spendingKey,
    ownerPub: ownerAddress(spendingKey),
    viewPrivateKey,
    viewPublicKey: secp256k1.getPublicKey(viewPrivateKey, true),
    spendPrivateKey,
    spendPublicKey: secp256k1.getPublicKey(spendPrivateKey, true),
  };
}

export function publicIdentity(keys: PrivacyKeys): PublicIdentity {
  return {
    ownerPub: keys.ownerPub,
    viewPublicKey: keys.viewPublicKey,
    spendPublicKey: keys.spendPublicKey,
  };
}
