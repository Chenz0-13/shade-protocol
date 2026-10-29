# Canton attestation

Canton is not a Groth16 verifier. Daml has no BN254 pairing, so a contract that stored a proof and returned success would be recording an unchecked blob. This repository does not do that.

The Robinhood Chain testnet pool (`contracts/evm`, chain id 46630) verifies the shielded-transfer proof. Canton only records a result that two named attestors jointly authorize.

## Trust assumption

`AttestorSet` is signed by a publisher who names the attestors. `threshold` is fixed at 2 because the `Record` choice requires exactly two controllers; a higher integer would be a lie, so the template rejects it.

`Record` succeeds only when both controllers are distinct members of that list. The ledger, not the contract body, checks that both parties authorized the transaction. The publisher cannot exercise `Record` alone. One attestor cannot either. An outsider who is not on the list cannot.

`Record` archives the set and recreates it with the nullifier appended to `spent`. A second record of that nullifier fails the assert, including when a different pair of attestors tries it. The SDK script ledger does not enforce contract-key uniqueness, so the spent list is the replay lock the tests actually run. `sourceTx` has to be non-empty. There is no proof field.

What Canton trusts is the attestors. They are supposed to sign only after the EVM pool has accepted the proof (the `Spent` event, the nullifier, and the source transaction). If two of them sign a result that never happened, Canton records it. That is an attestation, not a verifier.

## What is not claimed

- Canton does not check the Groth16 proof, the Merkle root, or the nullifier hash.
- The publisher is trusted to name the attestors. The publisher is not trusted to record a spend.
- Public Canton DevNet still needs a Super Validator sponsor and an egress-IP allowlist. Nothing here is deployed there.
- The TypeScript adapter throws `NotImplementedError`. It will not submit a proof, and it has no participant in this environment.

## Tests

`contracts/canton` builds with the Daml SDK 3.6.4 (`dpm`). `dpm test` runs the Daml Script files on the SDK ledger, which enforces party authorization and contract keys:

- two named attestors record a result
- one attestor is rejected
- an outsider is rejected
- the admin alone is rejected
- a reused nullifier is rejected
- an empty source transaction is rejected
