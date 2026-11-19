import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { encodeFunctionData, toFunctionSelector } from "viem";
import { ASSET_BASE, EXT_DOMAIN } from "../src/core/constants.js";
import { noteAad, openWithSecretKey, parseSealed } from "../src/core/crypto/encryption.js";
import { generatePrivacyKeys } from "../src/core/crypto/keys.js";
import { noteCommitment } from "../src/core/crypto/note.js";
import { shadePoolAbi, solidityProof } from "../src/core/chain/robinhood.js";
import {
  encodeShadeTransfer,
  encodeDeposit,
  nullifierPda,
  poolPda,
  vaultPda,
  WITHDRAW_COMPUTE_UNITS,
} from "../src/core/chain/solana.js";
import { formatAmount, parseAmount } from "../src/app/amount.js";
import { formatShieldedAddress, parseShieldedAddress } from "../src/app/address.js";
import { encodeDepositCall, encodeNullifierQuery, encodeShieldedTransferCall, functionSelector } from "../src/app/evmCall.js";
import { planShield, planSpend } from "../src/app/flows.js";
import { openForViewKey, protocolNoteAad, sealForViewKey, sealNoteGift, openNoteGift } from "../src/app/gift.js";
import {
  encodeDepositData,
  encodeWithdrawData,
  solanaNullifierAccount,
  solanaPoolAccounts,
  WITHDRAW_COMPUTE_UNITS as APP_COMPUTE_UNITS,
} from "../src/app/instruction.js";
import { insertionsInLog, leavesFromEvmLogs, leavesFromInstruction, readPoolHeader, DEPOSIT_TOPIC, SPENT_TOPIC } from "../src/app/leaves.js";
import { hexToBytes } from "../src/core/crypto/field.js";
import { MerkleTree } from "../src/core/merkle/MerkleTree.js";
import { keccak256, toBytes } from "viem";

const proof = {
  pi_a: ["1", "2", "1"],
  pi_b: [
    ["3", "4"],
    ["5", "6"],
  ],
  pi_c: ["7", "8", "1"],
  protocol: "groth16",
  curve: "bn128",
};

describe("app flows", () => {
  it("matches the SDK deposit and withdraw instruction bytes", () => {
    const opening = { blinding: 11n, rho: 12n, ownerPub: 13n, value: 99n };
    expect(encodeDepositData(opening)).toEqual(new Uint8Array(encodeDeposit(opening)));
    const signals = {
      merkleRoot: "1",
      nullifier: "2",
      commitmentOut1: "3",
      commitmentOut2: "4",
      withdrawAmount: "5",
      relayerFee: "6",
      extDataHash: "7",
    };
    const payload = { ...signals, proof };
    expect(encodeWithdrawData(proof, signals)).toEqual(new Uint8Array(encodeShadeTransfer(payload)));
    expect(APP_COMPUTE_UNITS).toBe(WITHDRAW_COMPUTE_UNITS);

    const program = new PublicKey("4VnXvKR2pwUio27hG8Q2VHxFj6gFENG6qa4AdqtvobSj");
    const accounts = solanaPoolAccounts(program);
    expect(accounts.pool.toBase58()).toBe(poolPda(program).toBase58());
    expect(accounts.vault.toBase58()).toBe(vaultPda(program).toBase58());
    expect(solanaNullifierAccount(program, 42n).toBase58()).toBe(nullifierPda(program, 42n).toBase58());
    expect(leavesFromInstruction(encodeDepositData(opening))[0]).toBe(
      noteCommitment({ ...opening, assetId: ASSET_BASE, chainHome: EXT_DOMAIN.solana }),
    );
  });

  it("matches the SDK Solidity calldata", () => {
    expect(`0x${functionSelector("deposit(uint256,uint256,uint256)")}`).toBe(
      toFunctionSelector("deposit(uint256,uint256,uint256)"),
    );
    const deposit = encodeDepositCall(4n, 5n, 6n);
    expect(deposit).toBe(
      encodeFunctionData({ abi: shadePoolAbi, functionName: "deposit", args: [4n, 5n, 6n] }),
    );
    expect(encodeNullifierQuery(4n)).toBe(
      encodeFunctionData({ abi: shadePoolAbi, functionName: "nullifiers", args: [4n] }),
    );
    const signals = ["8", "9", "10", "11", "12", "13", "14"];
    const recipient = "0x00000000000000000000000000000000000000aa";
    const relayer = "0x00000000000000000000000000000000000000bb";
    const solid = solidityProof({
      merkleRoot: signals[0]!,
      nullifier: signals[1]!,
      commitmentOut1: signals[2]!,
      commitmentOut2: signals[3]!,
      withdrawAmount: signals[4]!,
      relayerFee: signals[5]!,
      extDataHash: signals[6]!,
      proof,
    });
    expect(encodeShieldedTransferCall({ proof, publicSignals: signals, recipient, relayer })).toBe(
      encodeFunctionData({
        abi: shadePoolAbi,
        functionName: "shieldedTransfer",
        args: [solid.pA, solid.pB, solid.pC, solid.pubSignals, recipient, relayer],
      }),
    );
  });

  it("plans a shield and a withdraw that conserves value", () => {
    const keys = generatePrivacyKeys();
    const shield = planShield(keys.ownerPub, 50n, EXT_DOMAIN.solana);
    expect(shield.commitment).toBe(noteCommitment({ ...shield }));
    const ext = {
      recipientLo: 1n,
      recipientHi: 0n,
      relayerLo: 2n,
      relayerHi: 0n,
      poolLo: 3n,
      poolHi: 0n,
      chainDomain: EXT_DOMAIN.solana,
    };
    expect(() => planSpend({
      spendingKey: keys.spendingKey,
      note: { ...shield, leafIndex: null },
      leaves: [shield.commitment],
      withdrawAmount: 10n,
      relayerFee: 0n,
      out1: { value: 50n, ownerPub: keys.ownerPub },
      out2: { value: 0n, ownerPub: keys.ownerPub },
      ext,
    })).toThrow(/equal the note/);
    const spend = planSpend({
      spendingKey: keys.spendingKey,
      note: { ...shield, leafIndex: 0 },
      leaves: [shield.commitment],
      withdrawAmount: 20n,
      relayerFee: 0n,
      out1: { value: 30n, ownerPub: keys.ownerPub },
      out2: { value: 0n, ownerPub: keys.ownerPub },
      ext,
    });
    expect(spend.leafIndex).toBe(0);
    expect(spend.publicSignals[4]).toBe("20");
    expect(spend.commitmentIn).toBe(shield.commitment);
    expect(parseAmount("0.05", 9)).toBe(50_000_000n);
    expect(formatAmount(parseAmount("1.5", 18), 18)).toBe("1.5");
  });

  it("seals a gift the SDK can open and rebuilds pool leaves in order", async () => {
    const keys = generatePrivacyKeys();
    const commitment = 77n;
    expect(protocolNoteAad(commitment)).toEqual(new Uint8Array(noteAad(commitment)));
    const plaintext = new TextEncoder().encode("hello note");
    const aad = new TextEncoder().encode("shade.gift.v1");
    const sealed = await sealForViewKey(keys.viewPublicKey, plaintext, aad);
    const openedBySdk = new Uint8Array(openWithSecretKey(keys.viewPrivateKey, parseSealed(sealed), aad));
    expect(openedBySdk).toEqual(plaintext);
    expect(await openForViewKey(keys.viewPrivateKey, sealed, aad)).toEqual(plaintext);

    const gift = await sealNoteGift(keys.viewPublicKey, {
      v: 1,
      chainKey: "solana-devnet",
      commitment: "77",
      value: "5",
      blinding: "8",
      rho: "9",
      assetId: "1",
      chainHome: "1001",
      ownerPub: keys.ownerPub.toString(),
      memo: "",
    });
    expect(gift.startsWith("gift1")).toBe(true);
    expect((await openNoteGift(keys.viewPrivateKey, gift)).value).toBe("5");

    const address = formatShieldedAddress({
      ownerPub: keys.ownerPub,
      viewPublicKey: keys.viewPublicKey,
      spendPublicKey: keys.spendPublicKey,
    });
    expect(parseShieldedAddress(address).ownerPub).toBe(keys.ownerPub);
    expect(() => parseShieldedAddress("So11111111111111111111111111111111111111112")).toThrow(/shielded address/);

    const header = new Uint8Array(52);
    header.set(new TextEncoder().encode("SHADEpl1"));
    new DataView(header.buffer).setBigUint64(12, 3n, true);
    header[51] = 4;
    expect(readPoolHeader(header)).toEqual({ nextIndex: 3n, root: 4n });
    const live = new Uint8Array(52);
    live.set(
      hexToBytes(
        "5348414445706c32fffe010100000000000000002134e76ac5d21aab186c2be1dd8f84ee880a1e46eaf712f9d371b6df22191f3e",
      ),
    );
    expect(readPoolHeader(live)).toEqual({ nextIndex: 0n, root: MerkleTree.empty().root() });

    expect(`0x${DEPOSIT_TOPIC}`).toBe(keccak256(toBytes("Deposited(uint256,uint256,uint256,uint256)")));
    expect(`0x${SPENT_TOPIC}`).toBe(keccak256(toBytes("Spent(uint256,uint256,uint256,uint256,uint256,uint256)")));
    expect(insertionsInLog(`0x${DEPOSIT_TOPIC}`)).toBe(1);
    expect(insertionsInLog(SPENT_TOPIC)).toBe(2);
    expect(insertionsInLog("0xabcd")).toBe(0);
    const out1 = 5n;
    const out2 = 6n;
    const leaves = leavesFromEvmLogs([
      {
        topic0: `0x${SPENT_TOPIC}`,
        topic1: `0x${(3n).toString(16).padStart(64, "0")}`,
        data: `0x${word(out1)}${word(out2)}${word(0n)}${word(1n)}`,
        blockNumber: 2,
        transactionIndex: 0,
        logIndex: 0,
      },
      {
        topic0: `0x${DEPOSIT_TOPIC}`,
        topic1: `0x${(9n).toString(16).padStart(64, "0")}`,
        data: "0x",
        blockNumber: 1,
        transactionIndex: 1,
        logIndex: 0,
      },
    ]);
    expect(leaves).toEqual([9n, out1, out2]);
  });
});

function word(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}
