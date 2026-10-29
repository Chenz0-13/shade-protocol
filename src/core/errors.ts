export class NotImplementedError extends Error {
  constructor(feature: string) {
    super(`${feature} is not implemented. Refusing to report a simulated success.`);
    this.name = "NotImplementedError";
  }
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export class ProofError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProofError";
  }
}

export class DoubleSpendError extends Error {
  constructor(message = "nullifier is already spent or reserved") {
    super(message);
    this.name = "DoubleSpendError";
  }
}

export class DecryptionError extends Error {
  constructor() {
    super("ciphertext failed authentication");
    this.name = "DecryptionError";
  }
}
