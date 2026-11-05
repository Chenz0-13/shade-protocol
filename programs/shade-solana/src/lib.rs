//! Devnet Shade pool.
//!
//! The Groth16 verifying key is a single-party setup (`insecure-test-setup`).
//! Do not deploy this binary beyond devnet or testnet.
//!
//! Accounts
//! --------
//! Initialize (tag 0): payer, pool PDA, vault PDA, system program.
//!   Data: tag || min_deposit(u64 LE).
//! Deposit (tag 2): payer, pool PDA, vault PDA, system program.
//!   Data: tag || blinding(32) || rho(32) || owner_pub(32) || value(u64 LE).
//! Withdraw (tag 1): payer, pool PDA, vault PDA, nullifier PDA, recipient, system program.
//!   Data: tag || proof_a(64) || proof_b(128) || proof_c(64) || seven public inputs.
//!
//! The pool PDA stores the Poseidon frontier (`solana_poseidon` Bn254X5,
//! big-endian, the same parameters the circuit uses) and a ring of roots.
//! A nullifier PDA is created on withdraw with allocate, assign, and transfer,
//! so a prefunded system account cannot freeze the note. A second create fails,
//! which is the double-spend check. The vault PDA holds the deposited SOL.
//! Withdraw pays `withdrawAmount` to the recipient and `relayerFee` to the
//! fee payer, and leaves the vault rent-exempt. The tree is a depth-20 frontier.

#![allow(unexpected_cfgs)]

use pinocchio::{
    account::AccountView,
    address::Address,
    cpi::{invoke, invoke_signed, Seed, Signer},
    entrypoint,
    error::ProgramError,
    instruction::{InstructionAccount, InstructionView},
    ProgramResult,
};
use solana_poseidon::{hashv, Endianness, Parameters};

#[allow(dead_code)]
mod verifying_key;

entrypoint!(process_instruction);

pub const DEPTH: usize = 20;
pub const ROOT_HISTORY: usize = 32;
pub const POOL_SEED: &[u8] = b"pool";
pub const VAULT_SEED: &[u8] = b"vault";
pub const NULLIFIER_SEED: &[u8] = b"nullifier";
pub const IX_INIT: u8 = 0;
pub const IX_WITHDRAW: u8 = 1;
pub const IX_DEPOSIT: u8 = 2;
pub const INIT_LEN: usize = 1 + 8;
pub const WITHDRAW_LEN: usize = 1 + 64 + 128 + 64 + 7 * 32;
/// External-data domain for Solana devnet and testnet. Not an EVM chain id.
pub const SOLANA_EXT_DOMAIN: u64 = 1001;
pub const DEPOSIT_LEN: usize = 1 + 32 + 32 + 32 + 8;

pub const ERR_UNKNOWN_ROOT: u32 = 1;
pub const ERR_NULLIFIER_SPENT: u32 = 2;
pub const ERR_INVALID_PROOF: u32 = 3;
pub const ERR_BAD_ACCOUNT: u32 = 4;
pub const ERR_VALUE: u32 = 5;
pub const ERR_TREE_FULL: u32 = 6;
pub const ERR_EXT_DATA: u32 = 7;

const MAGIC: &[u8; 8] = b"SHADEpl2";
const NEXT_INDEX_OFFSET: usize = 12;
const ROOT_OFFSET: usize = 20;
const ZEROS_OFFSET: usize = 52;
const FILLED_OFFSET: usize = ZEROS_OFFSET + (DEPTH + 1) * 32;
const ROOTS_OFFSET: usize = FILLED_OFFSET + DEPTH * 32;
const MIN_DEPOSIT_OFFSET: usize = ROOTS_OFFSET + ROOT_HISTORY * 32;
pub const POOL_LEN: usize = MIN_DEPOSIT_OFFSET + 8;

/// BN128 scalar field, big-endian. Matches `BN128_FIELD` in the TypeScript tree.
const FIELD_BE: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91, 0x43, 0xe1, 0xf5, 0x93, 0xf0, 0x00, 0x00, 0x01,
];

/// Rent-exempt lamports at the legacy rate, which equals the SIMD-0194 minimum:
/// `(128 + space) * 6960`. Paying this still succeeds if the cluster rent is lower.
pub fn rent_exempt(space: u64) -> u64 {
    space.saturating_add(128).saturating_mul(6960)
}

pub fn process_instruction(
    program_id: &Address,
    accounts: &[AccountView],
    data: &[u8],
) -> ProgramResult {
    match data.first().copied() {
        Some(IX_INIT) if data.len() == INIT_LEN => initialize(program_id, accounts, data),
        Some(IX_DEPOSIT) if data.len() == DEPOSIT_LEN => deposit(program_id, accounts, data),
        Some(IX_WITHDRAW) if data.len() == WITHDRAW_LEN => withdraw(program_id, accounts, data),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

fn initialize(program_id: &Address, accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [payer, pool, vault, system] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    require_signer(payer)?;
    require_writable(pool)?;
    require_writable(vault)?;
    require_system(system)?;
    let pool_bump = require_pda(pool, &[POOL_SEED], program_id)?;
    let vault_bump = require_pda(vault, &[VAULT_SEED], program_id)?;
    let min_deposit = u64::from_le_bytes(data[1..9].try_into().unwrap());
    if min_deposit == 0 {
        return Err(ProgramError::Custom(ERR_VALUE));
    }

    create_pda(payer, pool, system, rent_exempt(POOL_LEN as u64), POOL_LEN as u64, program_id, POOL_SEED, pool_bump)?;
    create_pda(payer, vault, system, rent_exempt(0), 0, program_id, VAULT_SEED, vault_bump)?;

    let mut state = pool.try_borrow_mut()?;
    if state.len() != POOL_LEN {
        return Err(ProgramError::InvalidAccountData);
    }
    state[..8].copy_from_slice(MAGIC);
    state[8] = pool_bump;
    state[9] = vault_bump;
    init_frontier(&mut state)?;
    state[MIN_DEPOSIT_OFFSET..MIN_DEPOSIT_OFFSET + 8].copy_from_slice(&min_deposit.to_le_bytes());
    Ok(())
}

fn deposit(program_id: &Address, accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [payer, pool, vault, system] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    require_signer(payer)?;
    require_writable(pool)?;
    require_writable(vault)?;
    require_system(system)?;
    require_owned(pool, program_id)?;
    require_owned(vault, program_id)?;
    require_pda(pool, &[POOL_SEED], program_id)?;
    require_pda(vault, &[VAULT_SEED], program_id)?;

    let blinding: [u8; 32] = data[1..33].try_into().unwrap();
    let rho: [u8; 32] = data[33..65].try_into().unwrap();
    let owner: [u8; 32] = data[65..97].try_into().unwrap();
    let value = u64::from_le_bytes(data[97..105].try_into().unwrap());
    require_field(&blinding)?;
    require_field(&rho)?;
    require_field(&owner)?;
    let min_deposit = {
        let state = pool.try_borrow()?;
        require_magic(&state)?;
        u64::from_le_bytes(state[MIN_DEPOSIT_OFFSET..MIN_DEPOSIT_OFFSET + 8].try_into().unwrap())
    };
    if value == 0 || value < min_deposit {
        return Err(ProgramError::Custom(ERR_VALUE));
    }

    let commitment = commitment(value, &blinding, &rho, &owner)?;
    {
        let mut state = pool.try_borrow_mut()?;
        insert(&mut state, &commitment)?;
    }
    system_transfer(payer, vault, system, value)
}

fn withdraw(program_id: &Address, accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [payer, pool, vault, nullifier_account, recipient, system] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    require_signer(payer)?;
    require_writable(pool)?;
    require_writable(vault)?;
    require_writable(nullifier_account)?;
    require_writable(recipient)?;
    require_system(system)?;
    require_owned(pool, program_id)?;
    require_owned(vault, program_id)?;
    require_pda(pool, &[POOL_SEED], program_id)?;
    require_pda(vault, &[VAULT_SEED], program_id)?;

    let root: [u8; 32] = data[257..289].try_into().unwrap();
    let nullifier: [u8; 32] = data[289..321].try_into().unwrap();
    let out1: [u8; 32] = data[321..353].try_into().unwrap();
    let out2: [u8; 32] = data[353..385].try_into().unwrap();
    let withdraw_be: [u8; 32] = data[385..417].try_into().unwrap();
    let fee_be: [u8; 32] = data[417..449].try_into().unwrap();
    let ext_data: [u8; 32] = data[449..481].try_into().unwrap();
    require_field(&root)?;
    require_field(&nullifier)?;
    require_field(&out1)?;
    require_field(&out2)?;
    require_field(&withdraw_be)?;
    require_field(&fee_be)?;
    require_field(&ext_data)?;
    let withdraw_amount = fee_lamports(&withdraw_be)?;
    let relayer_fee = fee_lamports(&fee_be)?;

    let nullifier_bump = require_pda(nullifier_account, &[NULLIFIER_SEED, &nullifier], program_id)?;
    {
        let state = pool.try_borrow()?;
        require_magic(&state)?;
        if !known_root(&state, &root) {
            return Err(ProgramError::Custom(ERR_UNKNOWN_ROOT));
        }
    }
    if !is_fresh(nullifier_account) {
        return Err(ProgramError::Custom(ERR_NULLIFIER_SPENT));
    }
    let expected = ext_commitment(recipient.address(), payer.address(), pool.address(), &withdraw_be, &fee_be)?;
    if expected != ext_data {
        return Err(ProgramError::Custom(ERR_EXT_DATA));
    }

    verify_proof(data)?;
    create_nullifier(payer, nullifier_account, system, program_id, &nullifier, nullifier_bump)?;
    {
        let mut state = pool.try_borrow_mut()?;
        insert(&mut state, &out1)?;
        insert(&mut state, &out2)?;
    }
    pay(vault, recipient, payer, withdraw_amount, relayer_fee)
}

fn verify_proof(data: &[u8]) -> ProgramResult {
    let proof_a: &[u8; 64] = data[1..65].try_into().unwrap();
    let proof_b: &[u8; 128] = data[65..193].try_into().unwrap();
    let proof_c: &[u8; 64] = data[193..257].try_into().unwrap();
    let mut public_inputs = [[0u8; 32]; 7];
    for (index, chunk) in data[257..].chunks(32).enumerate() {
        public_inputs[index].copy_from_slice(chunk);
    }
    #[cfg(target_os = "solana")]
    {
        use groth16_solana::groth16::Groth16Verifier;
        let mut verifier = Groth16Verifier::new(
            proof_a,
            proof_b,
            proof_c,
            &public_inputs,
            &verifying_key::VERIFYINGKEY,
        )
        .map_err(|_| ProgramError::Custom(ERR_INVALID_PROOF))?;
        verifier
            .verify()
            .map_err(|_| ProgramError::Custom(ERR_INVALID_PROOF))?;
        Ok(())
    }
    #[cfg(not(target_os = "solana"))]
    {
        let _ = (proof_a, proof_b, proof_c, public_inputs);
        Err(ProgramError::Custom(ERR_INVALID_PROOF))
    }
}

fn ext_commitment(
    recipient: &Address,
    relayer: &Address,
    pool: &Address,
    withdraw: &[u8; 32],
    fee: &[u8; 32],
) -> Result<[u8; 32], ProgramError> {
    let (recipient_lo, recipient_hi) = split_addr(recipient.as_array());
    let (relayer_lo, relayer_hi) = split_addr(relayer.as_array());
    let (pool_lo, pool_hi) = split_addr(pool.as_array());
    let domain = be_bytes(5);
    let chain = be_bytes(SOLANA_EXT_DOMAIN);
    let binder = poseidon(&[&domain, &pool_lo, &pool_hi, &chain, withdraw, fee])?;
    let zero = [0u8; 32];
    poseidon(&[
        &recipient_lo,
        &recipient_hi,
        &relayer_lo,
        &relayer_hi,
        &binder,
        &zero,
    ])
}

fn split_addr(bytes: &[u8; 32]) -> ([u8; 32], [u8; 32]) {
    let mut hi = [0u8; 32];
    let mut lo = [0u8; 32];
    hi[16..].copy_from_slice(&bytes[..16]);
    lo[16..].copy_from_slice(&bytes[16..]);
    (lo, hi)
}

fn commitment(value: u64, blinding: &[u8; 32], rho: &[u8; 32], owner: &[u8; 32]) -> Result<[u8; 32], ProgramError> {
    let domain = be_bytes(1);
    let amount = be_bytes(value);
    let tag = asset_tag(1, SOLANA_EXT_DOMAIN)?;
    poseidon(&[&domain, &amount, blinding, rho, owner, &tag])
}

fn asset_tag(asset: u64, chain_home: u64) -> Result<[u8; 32], ProgramError> {
    let asset_tag = poseidon(&[&be_bytes(7), &be_bytes(asset)])?;
    let chain_tag = poseidon(&[&be_bytes(9), &be_bytes(chain_home)])?;
    poseidon(&[&asset_tag, &chain_tag])
}

fn init_frontier(data: &mut [u8]) -> ProgramResult {
    for level in 0..DEPTH {
        let current = read32(data, ZEROS_OFFSET + level * 32);
        let next = poseidon(&[&current, &current])?;
        write32(data, ZEROS_OFFSET + (level + 1) * 32, &next);
        write32(data, FILLED_OFFSET + level * 32, &current);
    }
    let root = read32(data, ZEROS_OFFSET + DEPTH * 32);
    push_root(data, &root);
    Ok(())
}

fn insert(data: &mut [u8], leaf: &[u8; 32]) -> ProgramResult {
    let mut next = u64::from_le_bytes(data[NEXT_INDEX_OFFSET..NEXT_INDEX_OFFSET + 8].try_into().unwrap());
    if next >= 1u64 << DEPTH {
        return Err(ProgramError::Custom(ERR_TREE_FULL));
    }
    let mut index = next;
    let mut current = *leaf;
    for level in 0..DEPTH {
        if index.is_multiple_of(2) {
            write32(data, FILLED_OFFSET + level * 32, &current);
            let zero = read32(data, ZEROS_OFFSET + level * 32);
            current = poseidon(&[&current, &zero])?;
        } else {
            let filled = read32(data, FILLED_OFFSET + level * 32);
            current = poseidon(&[&filled, &current])?;
        }
        index /= 2;
    }
    next += 1;
    data[NEXT_INDEX_OFFSET..NEXT_INDEX_OFFSET + 8].copy_from_slice(&next.to_le_bytes());
    push_root(data, &current);
    Ok(())
}

fn push_root(data: &mut [u8], root: &[u8; 32]) {
    let len = data[10] as usize;
    let pos = data[11] as usize;
    write32(data, ROOTS_OFFSET + pos * 32, root);
    write32(data, ROOT_OFFSET, root);
    data[11] = ((pos + 1) % ROOT_HISTORY) as u8;
    if len < ROOT_HISTORY {
        data[10] = (len + 1) as u8;
    }
}

fn known_root(data: &[u8], root: &[u8; 32]) -> bool {
    let len = data[10] as usize;
    let count = if len < ROOT_HISTORY { len } else { ROOT_HISTORY };
    (0..count).any(|index| &data[ROOTS_OFFSET + index * 32..ROOTS_OFFSET + (index + 1) * 32] == root)
}

fn poseidon(inputs: &[&[u8; 32]]) -> Result<[u8; 32], ProgramError> {
    let refs: [&[u8]; 6] = [
        inputs.first().copied().unwrap_or(&ZERO32),
        inputs.get(1).copied().unwrap_or(&ZERO32),
        inputs.get(2).copied().unwrap_or(&ZERO32),
        inputs.get(3).copied().unwrap_or(&ZERO32),
        inputs.get(4).copied().unwrap_or(&ZERO32),
        inputs.get(5).copied().unwrap_or(&ZERO32),
    ];
    let hash = hashv(Parameters::Bn254X5, Endianness::BigEndian, &refs[..inputs.len()])
        .map_err(|_| ProgramError::Custom(ERR_VALUE))?;
    Ok(hash.to_bytes())
}

const ZERO32: [u8; 32] = [0u8; 32];

fn pay(
    vault: &AccountView,
    recipient: &AccountView,
    relayer: &AccountView,
    withdraw_amount: u64,
    relayer_fee: u64,
) -> ProgramResult {
    let total = withdraw_amount.checked_add(relayer_fee).ok_or(ProgramError::Custom(ERR_VALUE))?;
    if total == 0 {
        return Ok(());
    }
    let rent = rent_exempt(vault.data_len() as u64);
    let balance = vault.lamports();
    if total > balance.saturating_sub(rent) {
        return Err(ProgramError::Custom(ERR_VALUE));
    }
    vault.set_lamports(balance - total);
    if recipient.address() == relayer.address() {
        recipient.set_lamports(recipient.lamports().saturating_add(total));
    } else {
        if withdraw_amount > 0 {
            recipient.set_lamports(recipient.lamports().saturating_add(withdraw_amount));
        }
        if relayer_fee > 0 {
            relayer.set_lamports(relayer.lamports().saturating_add(relayer_fee));
        }
    }
    Ok(())
}

/// Allocate, assign, and transfer. CreateAccount rejects an account that already
/// holds lamports, which lets an attacker prefund the PDA and freeze the note.
fn create_nullifier(
    payer: &AccountView,
    nullifier_account: &AccountView,
    system: &AccountView,
    program_id: &Address,
    nullifier: &[u8; 32],
    bump: u8,
) -> ProgramResult {
    let rent = rent_exempt(0);
    let have = nullifier_account.lamports();
    if have < rent {
        system_transfer(payer, nullifier_account, system, rent - have)?;
    }
    let bump_seed = [bump];
    let seeds = [
        Seed::from(NULLIFIER_SEED),
        Seed::from(nullifier.as_slice()),
        Seed::from(&bump_seed),
    ];
    system_signed(nullifier_account, system, &allocate_data(0), &seeds)?;
    system_signed(nullifier_account, system, &assign_data(program_id), &seeds)
}

fn allocate_data(space: u64) -> [u8; 12] {
    let mut data = [0u8; 12];
    data[..4].copy_from_slice(&8u32.to_le_bytes());
    data[4..].copy_from_slice(&space.to_le_bytes());
    data
}

fn assign_data(owner: &Address) -> [u8; 36] {
    let mut data = [0u8; 36];
    data[..4].copy_from_slice(&1u32.to_le_bytes());
    data[4..].copy_from_slice(owner.as_ref());
    data
}

fn system_signed(account: &AccountView, system: &AccountView, data: &[u8], seeds: &[Seed]) -> ProgramResult {
    let metas = [InstructionAccount::writable_signer(account.address())];
    let instruction = InstructionView {
        program_id: system.address(),
        data,
        accounts: &metas,
    };
    let signer = Signer::from(seeds);
    invoke_signed::<1>(&instruction, &[account], &[signer])
}

#[allow(clippy::too_many_arguments)]
fn create_pda(
    payer: &AccountView,
    account: &AccountView,
    system: &AccountView,
    lamports: u64,
    space: u64,
    owner: &Address,
    seed: &[u8],
    bump: u8,
) -> ProgramResult {
    let bump_seed = [bump];
    let seeds = [Seed::from(seed), Seed::from(&bump_seed)];
    create_account(payer, account, system, lamports, space, owner, &seeds)
}

fn create_account(
    payer: &AccountView,
    account: &AccountView,
    system: &AccountView,
    lamports: u64,
    space: u64,
    owner: &Address,
    seeds: &[Seed],
) -> ProgramResult {
    let mut data = [0u8; 52];
    data[4..12].copy_from_slice(&lamports.to_le_bytes());
    data[12..20].copy_from_slice(&space.to_le_bytes());
    data[20..52].copy_from_slice(owner.as_ref());
    let metas = [
        InstructionAccount::writable_signer(payer.address()),
        InstructionAccount::writable_signer(account.address()),
    ];
    let instruction = InstructionView {
        program_id: system.address(),
        data: &data,
        accounts: &metas,
    };
    let signer = Signer::from(seeds);
    invoke_signed::<2>(&instruction, &[payer, account], &[signer])
}

fn system_transfer(from: &AccountView, to: &AccountView, system: &AccountView, lamports: u64) -> ProgramResult {
    let mut data = [0u8; 12];
    data[..4].copy_from_slice(&2u32.to_le_bytes());
    data[4..].copy_from_slice(&lamports.to_le_bytes());
    let metas = [
        InstructionAccount::writable_signer(from.address()),
        InstructionAccount::writable(to.address()),
    ];
    let instruction = InstructionView {
        program_id: system.address(),
        data: &data,
        accounts: &metas,
    };
    invoke::<2>(&instruction, &[from, to])
}

fn require_signer(account: &AccountView) -> ProgramResult {
    if account.is_signer() && account.is_writable() {
        Ok(())
    } else {
        Err(ProgramError::MissingRequiredSignature)
    }
}

fn require_writable(account: &AccountView) -> ProgramResult {
    if account.is_writable() {
        Ok(())
    } else {
        Err(ProgramError::InvalidAccountData)
    }
}

fn require_system(account: &AccountView) -> ProgramResult {
    if account.address() == &Address::default() {
        Ok(())
    } else {
        Err(ProgramError::Custom(ERR_BAD_ACCOUNT))
    }
}

fn require_owned(account: &AccountView, program_id: &Address) -> ProgramResult {
    if account.owned_by(program_id) {
        Ok(())
    } else {
        Err(ProgramError::IncorrectProgramId)
    }
}

fn require_pda(account: &AccountView, seeds: &[&[u8]], program_id: &Address) -> Result<u8, ProgramError> {
    let (pda, bump) = Address::find_program_address(seeds, program_id);
    if account.address() == &pda {
        Ok(bump)
    } else {
        Err(ProgramError::Custom(ERR_BAD_ACCOUNT))
    }
}

fn require_magic(data: &[u8]) -> ProgramResult {
    if data.len() == POOL_LEN && data.starts_with(MAGIC) {
        Ok(())
    } else {
        Err(ProgramError::UninitializedAccount)
    }
}

fn require_field(value: &[u8; 32]) -> ProgramResult {
    if value < &FIELD_BE {
        Ok(())
    } else {
        Err(ProgramError::Custom(ERR_VALUE))
    }
}

/// A prefunded system account is still unspent. Lamports are allowed.
fn is_fresh(account: &AccountView) -> bool {
    account.owned_by(&Address::default()) && account.data_len() == 0
}

fn fee_lamports(fee: &[u8; 32]) -> Result<u64, ProgramError> {
    if fee[..24].iter().any(|byte| *byte != 0) {
        return Err(ProgramError::Custom(ERR_VALUE));
    }
    Ok(u64::from_be_bytes(fee[24..].try_into().unwrap()))
}

fn be_bytes(value: u64) -> [u8; 32] {
    let mut out = [0u8; 32];
    out[24..].copy_from_slice(&value.to_be_bytes());
    out
}

fn read32(data: &[u8], offset: usize) -> [u8; 32] {
    let mut out = [0u8; 32];
    out.copy_from_slice(&data[offset..offset + 32]);
    out
}

fn write32(data: &mut [u8], offset: usize, value: &[u8; 32]) {
    data[offset..offset + 32].copy_from_slice(value);
}
