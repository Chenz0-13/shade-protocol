import "./polyfill.js";
import { PublicKey } from "@solana/web3.js";
import { EXT_DOMAIN } from "../../src/core/constants.js";
import { generatePrivacyKeys } from "../../src/core/crypto/keys.js";
import { noteNullifier } from "../../src/core/crypto/note.js";
import { limbsFrom32, limbsFromAccount, limbsFromEvmAddress, type ExtDataLimbs } from "../../src/core/proof/extData.js";
import { formatAmount, parseAmount } from "../../src/app/amount.js";
import { formatShieldedAddress, parseShieldedAddress } from "../../src/app/address.js";
import {
  DEPLOYMENTS,
  chainHome,
  deploymentStatus,
  explorerTx,
  getDeployment,
  isEvmAddress,
  type ChainDeployment,
  type DeploymentStatus,
} from "../../src/app/deployments.js";
import { encodeDepositCall, encodeShieldedTransferCall } from "../../src/app/evmCall.js";
import { planShield, planSpend, type SpendPlan } from "../../src/app/flows.js";
import { openNoteGift, sealNoteGift } from "../../src/app/gift.js";
import {
  encodeDepositData,
  encodeWithdrawData,
  solanaNullifierAccount,
  solanaPoolAccounts,
  type Groth16ProofJson,
} from "../../src/app/instruction.js";
import {
  decryptVault,
  deriveVaultKey,
  encryptVault,
  identityFromKeys,
  keysFromIdentity,
  parseBackupFile,
  randomVaultSalt,
  shieldedBalance,
  type VaultBackupFile,
  type VaultNote,
  type VaultPayload,
} from "../../src/app/vault.js";
import {
  SOLANA_WITHDRAW_COMPUTE,
  isNullifierSpent,
  sendEvm,
  solanaInstruction,
  submitSolana,
  syncEvmPool,
  syncSolanaPool,
  type PoolView,
} from "./chain.js";
import { connectEvm, connectSolana, listEvmProviders, listSolanaProviders, signEvm, signSolana, type Eip1193, type SolanaProvider } from "./wallets.js";

interface Unlocked {
  kind: "evm" | "solana";
  address: string;
  key: CryptoKey;
  salt: Uint8Array;
  payload: VaultPayload;
}

interface Artifacts {
  wasm: Uint8Array;
  zkey: Uint8Array;
  vkey: object;
}

const state: {
  chainId: string;
  evm: { name: string; provider: Eip1193; address: string } | null;
  solana: { name: string; provider: SolanaProvider; address: string } | null;
  unlocked: Unlocked | null;
  pool: PoolView | null;
  poolError: string | null;
  artifacts: Artifacts | null;
  artifactNote: string;
  busy: boolean;
} = {
  chainId: "solana-devnet",
  evm: null,
  solana: null,
  unlocked: null,
  pool: null,
  poolError: null,
  artifacts: null,
  artifactNote: "Checking for proof files…",
  busy: false,
};

const $ = <T extends HTMLElement>(id: string) => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
};

const onboardKey = "shader.onboarded.v1";

function init(): void {
  renderChains();
  bindTabs();
  bindForms();
  renderWallet();
  renderVault();
  const seen = storageGet(onboardKey);
  if (seen !== "1") $<HTMLDivElement>("onboarding").hidden = false;
  $("onboard-ok").addEventListener("click", () => {
    storageSet(onboardKey, "1");
    $<HTMLDivElement>("onboarding").hidden = true;
  });
  $("help").addEventListener("click", () => {
    $<HTMLDivElement>("onboarding").hidden = false;
  });
  const evm = listEvmProviders();
  const picker = $<HTMLLabelElement>("evm-picker");
  const choice = $<HTMLSelectElement>("evm-choice");
  if (evm.length > 1) {
    picker.hidden = false;
    for (const item of evm) {
      const option = document.createElement("option");
      option.value = item.name;
      option.textContent = item.name;
      choice.append(option);
    }
  }
  $("connect-evm").addEventListener("click", () => void run(() => connectWallet("evm")));
  $("connect-solana").addEventListener("click", () => void run(() => connectWallet("solana")));
  $("unlock").addEventListener("click", () => void run(() => unlock()));
  void loadArtifacts();
  void refreshPool(false);
}

function bindTabs(): void {
  const tabs = ["shield", "send", "withdraw", "notes"] as const;
  for (const name of tabs) {
    $(`tab-${name}`).addEventListener("click", () => {
      for (const other of tabs) {
        $(`tab-${other}`).setAttribute("aria-selected", other === name ? "true" : "false");
        $<HTMLElement>(`panel-${other}`).hidden = other !== name;
      }
    });
  }
}

function bindForms(): void {
  $<HTMLFormElement>("shield-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void run(() => shield());
  });
  $<HTMLFormElement>("send-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void run(() => transfer("send"));
  });
  $<HTMLFormElement>("withdraw-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void run(() => transfer("withdraw"));
  });
  $<HTMLFormElement>("gift-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void run(() => importGift());
  });
  $("copy-address").addEventListener("click", () => void copyText($<HTMLTextAreaElement>("my-address").value));
  $("copy-gift").addEventListener("click", () => void copyText($<HTMLTextAreaElement>("gift-text").value));
  $("export-notes").addEventListener("click", () => void run(() => exportBackup()));
  $<HTMLInputElement>("import-file").addEventListener("change", (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) void run(() => importBackup(file));
  });
}

function renderChains(): void {
  const root = $("chains");
  root.replaceChildren();
  for (const chain of DEPLOYMENTS) {
    const status = deploymentStatus(chain);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chain";
    button.setAttribute("aria-pressed", chain.id === state.chainId ? "true" : "false");
    const title = document.createElement("b");
    title.textContent = chain.name;
    const detail = document.createElement("small");
    detail.textContent = chain.kind === "near"
      ? `Contract ${chain.contractId}. A NEAR wallet is not connected from this app yet.`
      : `${chain.nativeSymbol} · ${chain.network}`;
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = statusLabel(status);
    button.append(title, detail, badge);
    button.addEventListener("click", () => {
      state.chainId = chain.id;
      state.pool = null;
      state.poolError = null;
      renderChains();
      renderVault();
      void refreshPool(false);
    });
    const faucet = document.createElement("a");
    faucet.href = chain.faucetUrl;
    faucet.target = "_blank";
    faucet.rel = "noopener noreferrer";
    faucet.textContent = chain.faucetLabel;
    const wrap = document.createElement("div");
    wrap.className = "chain-wrap";
    faucet.className = "faucet";
    wrap.append(button, faucet);
    root.append(wrap);
  }
}

function renderWallet(): void {
  const parts: string[] = [];
  if (state.evm) parts.push(`${state.evm.name} ${short(state.evm.address)}`);
  if (state.solana) parts.push(`${state.solana.name} ${short(state.solana.address)}`);
  $("wallet-status").textContent = parts.length > 0 ? parts.join(" · ") : "No wallet connected.";
}

function renderVault(): void {
  const chain = getDeployment(state.chainId);
  const unlocked = matchingVault(chain);
  const balance = $("balance");
  if (!unlocked?.payload.identity) {
    balance.textContent = "Unlock notes to see it.";
    $<HTMLTextAreaElement>("my-address").value = "";
  } else {
    const amount = shieldedBalance(unlocked.payload.notes, chain.id);
    balance.textContent = `${formatAmount(amount, chain.nativeDecimals)} ${chain.nativeSymbol}`;
    const keys = keysFromIdentity(unlocked.payload.identity);
    $<HTMLTextAreaElement>("my-address").value = formatShieldedAddress({
      ownerPub: keys.ownerPub,
      viewPublicKey: keys.viewPublicKey,
      spendPublicKey: keys.spendPublicKey,
    });
  }
  fillSelect("send-note", chain, unlocked?.payload.notes ?? []);
  fillSelect("withdraw-note", chain, unlocked?.payload.notes ?? []);
  renderNoteList(chain, unlocked?.payload.notes ?? []);
  const ready = deploymentStatus(chain) === "deployed";
  $<HTMLButtonElement>("shield-submit").disabled = !ready || state.busy;
  $<HTMLButtonElement>("send-submit").disabled = !ready || state.busy || !state.artifacts;
  $<HTMLButtonElement>("withdraw-submit").disabled = !ready || state.busy || !state.artifacts;
  $("proof-note").textContent = state.artifactNote;
  const pool = $("pool-status");
  if (deploymentStatus(chain) === "coming-soon") {
    pool.textContent = `Coming soon. Contract ${chain.contractId} is on NEAR testnet. This app does not connect a NEAR wallet yet.`;
  }
  else if (!ready) pool.textContent = "Not deployed yet. Shield, send, and withdraw stay off until a pool address is added.";
  else if (state.pool) pool.textContent = `The pool is readable. It holds ${state.pool.nextIndex.toString()} notes.`;
  else pool.textContent = state.poolError ?? "Reading the pool…";
}

function fillSelect(id: string, chain: ChainDeployment, notes: readonly VaultNote[]): void {
  const select = $<HTMLSelectElement>(id);
  const previous = select.value;
  select.replaceChildren();
  const open = notes.filter((note) => note.chainKey === chain.id && !note.spent && BigInt(note.value) > 0n);
  if (open.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No notes on this chain yet";
    select.append(option);
    return;
  }
  for (const note of open) {
    const option = document.createElement("option");
    option.value = note.id;
    option.textContent = `${formatAmount(BigInt(note.value), chain.nativeDecimals)} ${chain.nativeSymbol}`;
    select.append(option);
  }
  if (open.some((note) => note.id === previous)) select.value = previous;
}

function renderNoteList(chain: ChainDeployment, notes: readonly VaultNote[]): void {
  const list = $("note-list");
  list.replaceChildren();
  const mine = notes.filter((note) => note.chainKey === chain.id);
  if (mine.length === 0) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "No private notes on this chain yet.";
    list.append(empty);
    return;
  }
  for (const note of mine) {
    const row = document.createElement("article");
    row.className = "note";
    const title = document.createElement("strong");
    title.textContent = `${formatAmount(BigInt(note.value), chain.nativeDecimals)} ${chain.nativeSymbol}`;
    const meta = document.createElement("p");
    meta.textContent = `${note.spent ? "Spent" : "Available"} · ${note.createdAt.slice(0, 10)} · ${note.commitment.slice(0, 12)}…`;
    row.append(title, meta);
    if (!note.spent) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn line";
      remove.textContent = "Remove from this browser";
      remove.addEventListener("click", () => {
        if (remove.dataset.confirm !== "1") {
          remove.dataset.confirm = "1";
          remove.textContent = "Confirm remove";
          return;
        }
        void run(async () => {
          const unlocked = requireVault();
          unlocked.payload.notes = unlocked.payload.notes.filter((item) => item.id !== note.id);
          await persist();
          setStatus("Removed from this browser. That does not return coins from the pool.");
        });
      });
      row.append(remove);
    }
    list.append(row);
  }
}

async function connectWallet(kind: "evm" | "solana"): Promise<void> {
  if (kind === "evm") {
    const providers = listEvmProviders();
    if (providers.length === 0) throw new Error("No EVM wallet was found. Install MetaMask, Rabby, or Phantom, then refresh.");
    const selected = $<HTMLSelectElement>("evm-choice").value;
    const match = providers.find((item) => item.name === selected) ?? providers[0];
    if (!match) throw new Error("No EVM wallet was found.");
    const address = await connectEvm(match.provider);
    state.evm = { name: match.name, provider: match.provider, address };
  } else {
    const providers = listSolanaProviders();
    if (providers.length === 0) throw new Error("No Solana wallet was found. Install Phantom or Solflare, then refresh.");
    const phantom = providers.find((item) => item.name === "Phantom") ?? providers[0];
    if (!phantom) throw new Error("No Solana wallet was found.");
    const address = await connectSolana(phantom.provider);
    state.solana = { name: phantom.name, provider: phantom.provider, address };
  }
  renderWallet();
  setStatus("Connected. Unlock notes before shielding. The signature is not a transaction.");
}

async function unlock(): Promise<void> {
  const chain = getDeployment(state.chainId);
  if (chain.kind === "near") throw new Error("NEAR is coming soon.");
  const wallet = requireWallet(chain);
  const signature = wallet.kind === "evm" ? await signEvm(wallet.provider, wallet.address) : await signSolana(wallet.provider);
  const stored = storageGet(storageKey(wallet.kind, wallet.address));
  if (!stored) {
    const salt = randomVaultSalt();
    const key = await deriveVaultKey(signature, salt);
    state.unlocked = {
      kind: wallet.kind,
      address: wallet.address,
      key,
      salt,
      payload: { identity: identityFromKeys(generatePrivacyKeys()), notes: [] },
    };
    await persist();
    setStatus("Notes are unlocked. A shielded address was created on this device.");
    return;
  }
  const file = JSON.parse(stored) as VaultBackupFile;
  const salt = parseBackupFile(file).salt;
  const key = await deriveVaultKey(signature, salt);
  const payload = await decryptVault(file, key);
  state.unlocked = { kind: wallet.kind, address: wallet.address, key, salt, payload };
  renderVault();
  setStatus("Notes unlocked.");
}

async function shield(): Promise<void> {
  const chain = requireDeployed();
  const unlocked = requireVault();
  if (!unlocked.payload.identity) throw new Error("Unlock notes first.");
  const value = parseAmount($<HTMLInputElement>("shield-amount").value, chain.nativeDecimals);
  const keys = keysFromIdentity(unlocked.payload.identity);
  const plan = planShield(keys.ownerPub, value, chainHome(chain));
  showProgress("Waiting for the wallet", 30, false);
  const wallet = requireWallet(chain);
  const sent =
    wallet.kind === "solana"
      ? await shieldSolana(chain, wallet.address, wallet.provider, plan)
      : await sendEvm({
          provider: wallet.provider,
          chain,
          from: wallet.address,
          data: encodeDepositCall(plan.blinding, plan.rho, plan.ownerPub),
          value,
        });
  remember(unlocked, chain, plan, sent.hash, sent.confirmed);
  await persist();
  if (sent.confirmed) await refreshPool(true);
  setStatus(
    sent.confirmed
      ? `Shielded ${formatAmount(value, chain.nativeDecimals)} ${chain.nativeSymbol}. The note is saved in this browser.`
      : "The transaction was sent but is not confirmed yet. Check the explorer before shielding again.",
  );
  setResult(chain, sent.hash);
}

async function shieldSolana(
  chain: ChainDeployment,
  payer: string,
  provider: SolanaProvider,
  plan: ReturnType<typeof planShield>,
): Promise<{ hash: string; confirmed: boolean }> {
  const program = new PublicKey(chain.programId);
  const accounts = solanaPoolAccounts(program);
  if (accounts.pool.toBase58() !== chain.poolAddress) throw new Error("The pool address does not match this program.");
  return submitSolana({
    rpcUrl: chain.rpcUrl,
    feePayer: payer,
    provider,
    instructions: [
      solanaInstruction({
        programId: chain.programId,
        payer,
        pool: accounts.pool.toBase58(),
        vault: accounts.vault.toBase58(),
        data: encodeDepositData(plan),
      }),
    ],
  });
}

async function transfer(mode: "send" | "withdraw"): Promise<void> {
  const chain = requireDeployed();
  if (!state.artifacts) throw new Error(state.artifactNote);
  const unlocked = requireVault();
  if (!unlocked.payload.identity) throw new Error("Unlock notes first.");
  if (!state.pool) await refreshPool(true);
  if (!state.pool) throw new Error("The pool history is not available, so a proof cannot be built.");
  const note = selectedNote(mode === "send" ? "send-note" : "withdraw-note", unlocked.payload.notes);
  const keys = keysFromIdentity(unlocked.payload.identity);
  const amount = parseAmount(
    $<HTMLInputElement>(mode === "send" ? "send-amount" : "withdraw-amount").value,
    chain.nativeDecimals,
  );
  const value = BigInt(note.value);
  if (amount > value) throw new Error("That amount is larger than the note.");
  const wallet = requireWallet(chain);
  const change = value - amount;
  let ext: ExtDataLimbs;
  let recipientAccount = wallet.address;
  let giftTo: ReturnType<typeof parseShieldedAddress> | null = null;
  if (mode === "send") {
    giftTo = parseShieldedAddress($<HTMLTextAreaElement>("send-address").value);
    ext = externalData(chain, wallet.address, wallet.address);
  } else {
    recipientAccount = $<HTMLInputElement>("withdraw-address").value.trim();
    if (chain.kind === "solana") {
      try {
        recipientAccount = new PublicKey(recipientAccount).toBase58();
      } catch {
        throw new Error("Enter a Solana address.");
      }
    } else if (!isEvmAddress(recipientAccount)) {
      throw new Error("Enter an EVM address that starts with 0x.");
    }
    ext = externalData(chain, recipientAccount, wallet.address);
  }
  const ownerOut = mode === "send" && giftTo ? giftTo.ownerPub : keys.ownerPub;
  const spend = planSpend({
    spendingKey: keys.spendingKey,
    note: {
      value,
      blinding: BigInt(note.blinding),
      rho: BigInt(note.rho),
      ownerPub: BigInt(note.ownerPub),
      assetId: BigInt(note.assetId),
      chainHome: BigInt(note.chainHome),
      leafIndex: note.leafIndex,
    },
    leaves: state.pool.leaves,
    withdrawAmount: mode === "withdraw" ? amount : 0n,
    relayerFee: 0n,
    out1: { value: mode === "send" ? amount : change, ownerPub: ownerOut },
    out2: { value: mode === "send" ? change : 0n, ownerPub: keys.ownerPub },
    ext,
  });
  showProgress("Creating a proof on this device", 20, true);
  const proved = await prove(spend, state.artifacts);
  showProgress("Waiting for the wallet", 92, false);
  const sent =
    wallet.kind === "solana"
      ? await spendSolana(chain, wallet.address, wallet.provider, recipientAccount, spend, proved.proof)
      : await sendEvm({
          provider: wallet.provider,
          chain,
          from: wallet.address,
          data: encodeShieldedTransferCall({
            proof: proved.proof,
            publicSignals: proved.publicSignals,
            recipient: recipientAccount,
            relayer: wallet.address,
          }),
          value: 0n,
        });
  if (sent.confirmed) {
    note.spent = true;
    rememberOutput(unlocked, chain, spend.outputs[1], sent.hash, keys.ownerPub);
    if (mode === "withdraw") rememberOutput(unlocked, chain, spend.outputs[0], sent.hash, keys.ownerPub);
    await persist();
    await refreshPool(true);
  }
  if (mode === "send" && giftTo && spend.outputs[0].value > 0n) {
    const gift = await sealNoteGift(giftTo.viewPublicKey, {
      v: 1,
      chainKey: chain.id,
      commitment: spend.outputs[0].commitment.toString(),
      value: spend.outputs[0].value.toString(),
      blinding: spend.outputs[0].blinding.toString(),
      rho: spend.outputs[0].rho.toString(),
      assetId: spend.outputs[0].assetId.toString(),
      chainHome: spend.outputs[0].chainHome.toString(),
      ownerPub: spend.outputs[0].ownerPub.toString(),
      memo: "Private send",
    });
    $<HTMLTextAreaElement>("gift-text").value = gift;
    $<HTMLDivElement>("gift-box").hidden = false;
  }
  setStatus(
    sent.confirmed
      ? mode === "send"
        ? "The private send was accepted. Copy the encrypted note and give it to the recipient."
        : "Withdrawal accepted. The public address can see the coins."
      : "The transaction was sent but is not confirmed yet. Check the explorer before trying again.",
  );
  setResult(chain, sent.hash);
}

async function spendSolana(
  chain: ChainDeployment,
  payer: string,
  provider: SolanaProvider,
  recipient: string,
  spend: SpendPlan,
  proof: Groth16ProofJson,
): Promise<{ hash: string; confirmed: boolean }> {
  const program = new PublicKey(chain.programId);
  const accounts = solanaPoolAccounts(program);
  if (accounts.pool.toBase58() !== chain.poolAddress) throw new Error("The pool address does not match this program.");
  return submitSolana({
    rpcUrl: chain.rpcUrl,
    feePayer: payer,
    provider,
    computeUnits: SOLANA_WITHDRAW_COMPUTE,
    instructions: [
      solanaInstruction({
        programId: chain.programId,
        payer,
        pool: accounts.pool.toBase58(),
        vault: accounts.vault.toBase58(),
        nullifier: solanaNullifierAccount(program, spend.nullifier).toBase58(),
        recipient,
        data: encodeWithdrawData(proof, {
          merkleRoot: spend.publicSignals[0] ?? "",
          nullifier: spend.publicSignals[1] ?? "",
          commitmentOut1: spend.publicSignals[2] ?? "",
          commitmentOut2: spend.publicSignals[3] ?? "",
          withdrawAmount: spend.publicSignals[4] ?? "",
          relayerFee: spend.publicSignals[5] ?? "",
          extDataHash: spend.publicSignals[6] ?? "",
        }),
      }),
    ],
  });
}

async function importGift(): Promise<void> {
  const unlocked = requireVault();
  if (!unlocked.payload.identity) throw new Error("Unlock notes first.");
  const keys = keysFromIdentity(unlocked.payload.identity);
  const gift = await openNoteGift(keys.viewPrivateKey, $<HTMLTextAreaElement>("gift-in").value);
  if (unlocked.payload.notes.some((note) => note.commitment === gift.commitment)) {
    throw new Error("That note is already in this browser.");
  }
  unlocked.payload.notes.push({
    id: crypto.randomUUID(),
    chainKey: gift.chainKey,
    commitment: gift.commitment,
    value: gift.value,
    blinding: gift.blinding,
    rho: gift.rho,
    assetId: gift.assetId,
    chainHome: gift.chainHome,
    ownerPub: gift.ownerPub,
    leafIndex: null,
    memo: gift.memo,
    spent: false,
    createdAt: new Date().toISOString(),
    originTx: "",
  });
  await persist();
  $<HTMLTextAreaElement>("gift-in").value = "";
  setStatus("Note added. Refresh happens when you send or withdraw, so the pool can find it.");
}

async function exportBackup(): Promise<void> {
  const unlocked = requireVault();
  const file = await encryptVault(unlocked.payload, unlocked.key, unlocked.salt);
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "shader-testnet-notes.json";
  link.click();
  URL.revokeObjectURL(url);
  setStatus("Backup downloaded. It does not contain a readable key. Keep it, and remember which wallet signed it.");
}

async function importBackup(file: File): Promise<void> {
  const chain = getDeployment(state.chainId);
  const wallet = requireWallet(chain);
  const parsed = JSON.parse(await file.text()) as VaultBackupFile;
  const signature = wallet.kind === "evm" ? await signEvm(wallet.provider, wallet.address) : await signSolana(wallet.provider);
  const salt = parseBackupFile(parsed).salt;
  const key = await deriveVaultKey(signature, salt);
  const payload = await decryptVault(parsed, key);
  state.unlocked = { kind: wallet.kind, address: wallet.address, key, salt, payload };
  await persist();
  setStatus("Backup imported and locked to this wallet signature.");
}

async function refreshPool(required: boolean): Promise<void> {
  const chain = getDeployment(state.chainId);
  if (deploymentStatus(chain) !== "deployed") {
    state.pool = null;
    renderVault();
    return;
  }
  try {
    state.poolError = null;
    state.pool = chain.kind === "solana" ? await syncSolanaPool(chain.rpcUrl, chain.programId, chain.poolAddress) : await syncEvmPool(chain);
    const unlocked = matchingVault(chain);
    if (unlocked?.payload.identity) {
      const keys = keysFromIdentity(unlocked.payload.identity);
      let changed = false;
      for (const note of unlocked.payload.notes) {
        if (note.chainKey !== chain.id) continue;
        const index = state.pool.leaves.findIndex((leaf) => leaf === BigInt(note.commitment));
        if (index >= 0 && note.leafIndex !== index) {
          note.leafIndex = index;
          changed = true;
        }
        if (!note.spent) {
          const spent = note.leafIndex === null
            ? false
            : await isNullifierSpent(
                chain,
                noteNullifier(keys.spendingKey, BigInt(note.commitment), BigInt(note.leafIndex)),
              );
          if (spent) {
            note.spent = true;
            changed = true;
          }
        }
      }
      if (changed) await persist();
    }
    renderVault();
  } catch (error) {
    state.pool = null;
    state.poolError = explain(error);
    $("pool-status").textContent = state.poolError;
    if (required) throw error;
  }
}

function remember(
  unlocked: Unlocked,
  chain: ChainDeployment,
  plan: ReturnType<typeof planShield>,
  hash: string,
  confirmed: boolean,
): void {
  unlocked.payload.notes.push({
    id: crypto.randomUUID(),
    chainKey: chain.id,
    commitment: plan.commitment.toString(),
    value: plan.value.toString(),
    blinding: plan.blinding.toString(),
    rho: plan.rho.toString(),
    assetId: plan.assetId.toString(),
    chainHome: plan.chainHome.toString(),
    ownerPub: plan.ownerPub.toString(),
    leafIndex: null,
    memo: confirmed ? "Shield" : "Waiting for confirmation",
    spent: false,
    createdAt: new Date().toISOString(),
    originTx: hash,
  });
}

function rememberOutput(
  unlocked: Unlocked,
  chain: ChainDeployment,
  output: SpendPlan["outputs"][number],
  hash: string,
  ownerPub: bigint,
): void {
  if (output.value <= 0n || output.ownerPub !== ownerPub) return;
  unlocked.payload.notes.push({
    id: crypto.randomUUID(),
    chainKey: chain.id,
    commitment: output.commitment.toString(),
    value: output.value.toString(),
    blinding: output.blinding.toString(),
    rho: output.rho.toString(),
    assetId: output.assetId.toString(),
    chainHome: output.chainHome.toString(),
    ownerPub: output.ownerPub.toString(),
    leafIndex: null,
    memo: "Change",
    spent: false,
    createdAt: new Date().toISOString(),
    originTx: hash,
  });
}

function externalData(chain: ChainDeployment, recipient: string, relayer: string): ExtDataLimbs {
  const [poolLo, poolHi] = poolLimbs(chain);
  if (chain.kind === "solana") {
    const [recipientLo, recipientHi] = limbsFrom32(new PublicKey(recipient).toBytes());
    const [relayerLo, relayerHi] = limbsFrom32(new PublicKey(relayer).toBytes());
    return { recipientLo, recipientHi, relayerLo, relayerHi, poolLo, poolHi, chainDomain: EXT_DOMAIN.solana };
  }
  const [recipientLo, recipientHi] = limbsFromEvmAddress(recipient);
  const [relayerLo, relayerHi] = limbsFromEvmAddress(relayer);
  return { recipientLo, recipientHi, relayerLo, relayerHi, poolLo, poolHi, chainDomain: chainHome(chain) };
}

function poolLimbs(chain: ChainDeployment): [bigint, bigint] {
  if (chain.kind === "solana") return limbsFrom32(new PublicKey(chain.poolAddress).toBytes());
  if (chain.kind === "near") return limbsFromAccount(chain.contractId);
  return limbsFromEvmAddress(chain.poolAddress);
}

function prove(spend: SpendPlan, artifacts: Artifacts): Promise<{ proof: Groth16ProofJson; publicSignals: string[] }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./prove.worker.ts", import.meta.url), { type: "module" });
    const started = Date.now();
    const timer = window.setInterval(() => {
      const seconds = Math.max(1, Math.round((Date.now() - started) / 1000));
      $("progress-detail").textContent = `Still working, ${seconds}s. A phone can take a few minutes. Leave this tab open.`;
    }, 1000);
    worker.onmessage = (event: MessageEvent<{ type: string; message?: string; proof?: Groth16ProofJson; publicSignals?: string[] }>) => {
      const data = event.data;
      if (data.type === "progress" && data.message) {
        $("progress-detail").textContent = data.message;
        const match = /(\d+)%/.exec(data.message);
        if (match?.[1]) setBar(20 + Math.round(Number(match[1]) * 0.65));
        return;
      }
      window.clearInterval(timer);
      worker.terminate();
      if (data.type === "done" && data.proof && data.publicSignals) resolve({ proof: data.proof, publicSignals: data.publicSignals });
      else reject(new Error(data.message || "The proof failed."));
    };
    worker.onerror = () => {
      window.clearInterval(timer);
      worker.terminate();
      reject(new Error("The proof stopped unexpectedly."));
    };
    worker.postMessage({
      witness: spend.witness,
      wasm: artifacts.wasm,
      zkey: artifacts.zkey,
      vkey: artifacts.vkey,
      publicSignals: spend.publicSignals,
    });
  });
}

async function loadArtifacts(): Promise<void> {
  try {
    const wasmUrl = new URL("artifacts/shielded_transfer.wasm", document.baseURI);
    const zkeyUrl = new URL("artifacts/shielded_transfer_final.zkey", document.baseURI);
    const vkeyUrl = new URL("artifacts/verification_key.json", document.baseURI);
    const wasm = await fetchBytes(wasmUrl.href);
    const zkey = await fetchBytes(zkeyUrl.href);
    const vkeyResponse = await fetch(vkeyUrl);
    if (!vkeyResponse.ok) throw new Error("missing");
    state.artifacts = { wasm, zkey, vkey: (await vkeyResponse.json()) as object };
    state.artifactNote =
      "Proof files are the pinned development setup. Creating one often takes 15–90 seconds, and longer on a phone. A pool accepts the proof only when it was deployed from these same files.";
  } catch {
    state.artifacts = null;
    state.artifactNote =
      "Proof files are not in this copy of the site. Shield still works. Private send and withdraw need the circuit wasm and zkey from the development setup.";
  }
  renderVault();
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error("missing");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const step = await reader.read();
    if (step.done) break;
    chunks.push(step.value);
    loaded += step.value.byteLength;
  }
  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function persist(): Promise<void> {
  const unlocked = state.unlocked;
  if (!unlocked) return;
  const file = await encryptVault(unlocked.payload, unlocked.key, unlocked.salt);
  const saved = storageSet(storageKey(unlocked.kind, unlocked.address), JSON.stringify(file));
  renderVault();
  if (!saved) setStatus("This browser did not store the notes. Export a backup before you close the tab.");
}

function requireDeployed(): ChainDeployment {
  const chain = getDeployment(state.chainId);
  const status = deploymentStatus(chain);
  if (status === "coming-soon") throw new Error("NEAR is coming soon.");
  if (status !== "deployed") throw new Error(`${chain.name} is not deployed yet.`);
  return chain;
}

function requireWallet(chain: ChainDeployment):
  | { kind: "evm"; address: string; provider: Eip1193 }
  | { kind: "solana"; address: string; provider: SolanaProvider } {
  if (chain.kind === "solana") {
    if (!state.solana) throw new Error("Connect a Solana wallet first.");
    return { kind: "solana", address: state.solana.address, provider: state.solana.provider };
  }
  if (chain.kind === "evm") {
    if (!state.evm) throw new Error("Connect an EVM wallet first.");
    return { kind: "evm", address: state.evm.address, provider: state.evm.provider };
  }
  throw new Error("NEAR is coming soon.");
}

function requireVault(): Unlocked {
  const chain = getDeployment(state.chainId);
  const unlocked = matchingVault(chain);
  if (!unlocked) throw new Error("Unlock notes with the wallet for this chain.");
  return unlocked;
}

function matchingVault(chain: ChainDeployment): Unlocked | null {
  const unlocked = state.unlocked;
  if (!unlocked || chain.kind === "near" || unlocked.kind !== chain.kind) return null;
  const wallet = chain.kind === "solana" ? state.solana : state.evm;
  if (!wallet) return null;
  const same = chain.kind === "evm" ? wallet.address.toLowerCase() === unlocked.address.toLowerCase() : wallet.address === unlocked.address;
  return same ? unlocked : null;
}

function selectedNote(selectId: string, notes: readonly VaultNote[]): VaultNote {
  const id = $<HTMLSelectElement>(selectId).value;
  const note = notes.find((item) => item.id === id && !item.spent);
  if (!note) throw new Error("Choose a note.");
  return note;
}

function storageKey(kind: string, address: string): string {
  const id = kind === "evm" ? address.toLowerCase() : address;
  return `shader.vault.v1:${kind}:${id}`;
}

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function statusLabel(status: DeploymentStatus): string {
  if (status === "deployed") return "Live on devnet";
  if (status === "coming-soon") return "Coming soon";
  return "Not deployed yet";
}

function short(value: string): string {
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

function showProgress(label: string, percent: number, busy: boolean): void {
  const box = $<HTMLDivElement>("progress");
  box.hidden = false;
  $("progress-label").textContent = label;
  $("progress-detail").textContent = "";
  const bar = $("progress-bar");
  bar.classList.toggle("busy", busy);
  setBar(percent);
}

function setBar(percent: number): void {
  $("progress-bar").style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

function hideProgress(): void {
  $<HTMLDivElement>("progress").hidden = true;
  $("progress-bar").classList.remove("busy");
}

function setStatus(message: string): void {
  $("status").textContent = message;
}

function setResult(chain: ChainDeployment, hash: string): void {
  const result = $("result");
  result.replaceChildren();
  const link = document.createElement("a");
  link.href = explorerTx(chain, hash);
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "View transaction";
  result.append(link);
}

async function copyText(value: string): Promise<void> {
  if (!value) return;
  await navigator.clipboard.writeText(value);
  setStatus("Copied.");
}

function explain(error: unknown): string {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  if (/user rejected|user denied|rejected the request|denied transaction signature/i.test(message)) {
    return "The wallet closed the request. Nothing was sent.";
  }
  const line = message.split("\n")[0] ?? message;
  return line.length > 280 ? `${line.slice(0, 280)}…` : line;
}

async function run(action: () => Promise<void>): Promise<void> {
  if (state.busy) return;
  state.busy = true;
  renderVault();
  try {
    await action();
  } catch (error) {
    setStatus(explain(error));
  } finally {
    state.busy = false;
    hideProgress();
    renderVault();
  }
}

init();
