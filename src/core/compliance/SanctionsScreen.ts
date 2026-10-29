/**
 * Address screening hook. The protocol calls this before accepting a
 * credential presentation. Implementing a real sanctions list is out of
 * scope; do not treat the absence of a hit as a compliance determination
 * unless the injected screen actually checks one.
 */
export interface SanctionsScreen {
  isBlocked(address: string): Promise<boolean>;
}

export class StaticSanctionsScreen implements SanctionsScreen {
  constructor(private readonly blocked: ReadonlySet<string>) {}

  async isBlocked(address: string): Promise<boolean> {
    return this.blocked.has(address);
  }
}

/**
 * Devnet placeholder. It does not consult a sanctions list and never blocks.
 * Replace it before any deployment that claims to screen addresses.
 */
export class DevnetPermissiveScreen implements SanctionsScreen {
  async isBlocked(_address: string): Promise<boolean> {
    return false;
  }
}
