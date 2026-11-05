# Shader Protocol note format v2

Devnet format. Not audited and not for mainnet.

A note opening is:

| Field | Meaning |
| --- | --- |
| value | 64-bit amount |
| blinding | secret field element |
| rho | secret field element. Deposit rho is chosen by the depositor. Spend outputs derive rho from the input nullifier. |
| owner | Poseidon(owner domain, spending key) |
| assetId | asset identifier |
| chainHome | chain that minted the note |

The asset and the chain are domain tagged, then packed, so every chain can use the same 6-input commitment:

```
assetTag  = Poseidon(7, assetId)
chainTag  = Poseidon(9, chainHome)
packed    = Poseidon(assetTag, chainTag)
commitment = Poseidon(1, value, blinding, rho, owner, packed)
```

Domain 7 is the asset tag and domain 9 is the chain tag. Domain 1 is the commitment. A note minted on Robinhood Chain testnet (chain id 46630) does not open on Elysium testnet (99801) unless a teleport mint inserts that commitment into the destination tree.

The nullifier is unchanged from the hardening pass:

```
nullifier = Poseidon(2, spendingKey, commitment, leafIndex)
rhoOut    = Poseidon(6, nullifier, outputIndex)
```

Output index 1 is the first output. Output index 2 is the change note.

## Shared circuit family

All of these use the v2 commitment and the same external-data hash:

```
binder     = Poseidon(5, poolLo, poolHi, chainDomain, withdrawAmount, relayerFee)
extDataHash = Poseidon(recipientLo, recipientHi, relayerLo, relayerHi, binder, 0)
```

| Circuit | File | What it proves | Public inputs |
| --- | --- | --- | --- |
| Withdraw / shielded transfer | `circuits/shielded_transfer.circom` | 1 input, 2 outputs, public withdraw amount, relayer fee | root, nullifier, out1, out2, withdrawAmount, relayerFee, extDataHash |
| Transfer | `circuits/transfer.circom` | 2 inputs, 2 outputs, same asset and chain | root, nullifier0, nullifier1, out0, out1, extDataHash |
| Teleport out | `circuits/teleport_out.circom` | Burn one note. The output commitment uses `destChain` as chainHome. | root, nullifier, commitmentOut, destChain, amount, relayerFee, extDataHash |

EVM, Solana, and NEAR verify the withdraw circuit with that public-input order. The transfer and teleport circuits are the same family. Their proving keys are not produced by the default `npm run circuit:setup` run, which builds the withdraw circuit only. Compile them with `circom` before treating a proof as real. The setup remains a single-party development setup.

## Chain home values

| Chain | chainHome |
| --- | --- |
| Robinhood Chain testnet | 46630 |
| Kinetiq Elysium testnet | 99801 |
| HyperEVM testnet | 998 |
| Base Sepolia | 84532 |
| Solana devnet and testnet | 1001 |
| NEAR testnet | 1002 |
| Local matcher notes | 0 |

Anvil (31337) is a local EVM chain id used by deploy scripts. It is not a mainnet.
