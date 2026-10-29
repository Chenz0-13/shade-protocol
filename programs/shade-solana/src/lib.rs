//! Devnet Shade pool.
//!
//! The Groth16 verifying key is a single-party setup (`insecure-test-setup`).
//! Do not deploy this binary beyond devnet or testnet.
//!
//! Accounts
//! --------
//! Initialize (tag 0): payer, pool PDA, vault PDA, system program.
//! Deposit (tag 2): payer, pool PDA, vault PDA, system program.
//!   Data: tag || blinding(32) || rho(32) || owner_pub(32) || value(u64 LE).
//! Withdraw (tag 1): payer, pool PDA, vault PDA, nullifier PDA, recipient, system program.
//!   Data: tag || proof_a(64) || proof_b(128) || proof_c(64) || five public inputs.
//!
//! The pool PDA stores the Poseidon frontier (`solana_poseidon` Bn254X5,
//! big-endian, the same parameters the circuit uses) and a ring of roots.
//! A nullifier PDA is created on withdraw; a second create fails, which is
//! the double-spend check. The vault PDA holds the deposited SOL. Withdraw
//! pays `fee` lamports from the vault to the recipient and leaves the vault
//! rent-exempt.

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

mod verifying_key;

entrypoint!(process_instruction);

pub const DEPTH: usize = 8;
pub const ROOT_HISTORY: usize = 32;
pub const POOL_SEED: &[u8] = b"pool";
pub const VAULT_SEED: &[u8] = b"vault";
pub const NULLIFIER_SEED: &[u8] = b"nullifier";
pub const IX_INIT: u8 = 0;
pub const IX_WITHDRAW: u8 = 1;
pub const IX_DEPOSIT: u8 = 2;
pub const WITHDRAW_LEN: usize = 1 + 64 + 128 + 64 + 5 * 32;
pub const DEPOSIT_LEN: usize = 1 + 32 + 32 + 32 + 8;

pub const ERR_UNKNOWN_ROOT: u32 = 1;
pub const ERR_NULLIFIER_SPENT: u32 = 2;
pub const ERR_INVALID_PROOF: u32 = 3;
pub const ERR_BAD_ACCOUNT: u32 = 4;
pub const ERR_VALUE: u32 = 5;
pub const ERR_TREE_FULL: u32 = 6;

const MAGIC: &[u8; 8] = b"SHADEpl1";
const NEXT_INDEX_OFFSET: usize = 12;
const ROOT_OFFSET: usize = 20;
const ZEROS_OFFSET: usize = 52;
const FILLED_OFFSET: usize = ZEROS_OFFSET + (DEPTH + 1) * 32;
const ROOTS_OFFSET: usize = FILLED_OFFSET + DEPTH * 32;
pub const POOL_LEN: usize = ROOTS_OFFSET + ROOT_HISTORY * 32;

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
        Some(IX_INIT) if data.len() == 1 => initialize(program_id, accounts),
        Some(IX_DEPOSIT) if data.len() == DEPOSIT_LEN => deposit(program_id, accounts, data),
        Some(IX_WITHDRAW) if data.len() == WITHDRAW_LEN => withdraw(program_id, accounts, data),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

fn initialize(program_id: &Address, accounts: &[AccountView]) -> ProgramResult {
    let [payer, pool, vault, system] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    require_signer(payer)?;
    require_writable(pool)?;
    require_writable(vault)?;
    require_system(system)?;
    let pool_bump = require_pda(pool, &[POOL_SEED], program_id)?;
    let vault_bump = require_pda(vault, &[VAULT_SEED], program_id)?;

    create_pda(payer, pool, system, rent_exempt(POOL_LEN as u64), POOL_LEN as u64, program_id, POOL_SEED, pool_bump)?;
    create_pda(payer, vault, system, rent_exempt(0), 0, program_id, VAULT_SEED, vault_bump)?;

    let mut data = pool.try_borrow_mut()?;
    if data.len() != POOL_LEN {
        return Err(ProgramError::InvalidAccountData);
    }
    data[..8].copy_from_slice(MAGIC);
    data[8] = pool_bump;
    data[9] = vault_bump;
    init_frontier(&mut data)?;
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
    if value == 0 {
        return Err(ProgramError::Custom(ERR_VALUE));
    }

    let commitment = commitment(value, &blinding, &rho, &owner)?;
    {
        let mut state = pool.try_borrow_mut()?;
        require_magic(&state)?;
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
    let fee_be: [u8; 32] = data[385..417].try_into().unwrap();
    require_field(&root)?;
    require_field(&nullifier)?;
    require_field(&out1)?;
    require_field(&out2)?;
    require_field(&fee_be)?;
    let fee = fee_lamports(&fee_be)?;

    let nullifier_bump = require_pda(nullifier_account, &[NULLIFIER_SEED, &nullifier], program_id)?;
    {
        let state = pool.try_borrow()?;
        require_magic(&state)?;
        if !known_root(&state, &root) {
            return Err(ProgramError::Custom(ERR_UNKNOWN_ROOT));
        }
    }
    if !is_fresh(nullifier_account, program_id) {
        return Err(ProgramError::Custom(ERR_NULLIFIER_SPENT));
    }

    verify_proof(data)?;
    create_nullifier(payer, nullifier_account, system, program_id, &nullifier, nullifier_bump)?;
    {
        let mut state = pool.try_borrow_mut()?;
        insert(&mut state, &out1)?;
        insert(&mut state, &out2)?;
    }
    pay_fee(vault, recipient, fee)
}

fn verify_proof(data: &[u8]) -> ProgramResult {
    let proof_a: &[u8; 64] = data[1..65].try_into().unwrap();
    let proof_b: &[u8; 128] = data[65..193].try_into().unwrap();
    let proof_c: &[u8; 64] = data[193..257].try_into().unwrap();
    let mut public_inputs = [[0u8; 32]; 5];
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

fn commitment(value: u64, blinding: &[u8; 32], rho: &[u8; 32], owner: &[u8; 32]) -> Result<[u8; 32], ProgramError> {
    let domain = be_bytes(1);
    let asset = be_bytes(1);
    let amount = be_bytes(value);
    poseidon(&[&domain, &amount, blinding, rho, owner, &asset])
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
        if index % 2 == 0 {
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

fn pay_fee(vault: &AccountView, recipient: &AccountView, fee: u64) -> ProgramResult {
    if fee == 0 {
        return Ok(());
    }
    let rent = rent_exempt(vault.data_len() as u64);
    let balance = vault.lamports();
    if fee > balance.saturating_sub(rent) {
        return Err(ProgramError::Custom(ERR_VALUE));
    }
    vault.set_lamports(balance - fee);
    recipient.set_lamports(recipient.lamports().saturating_add(fee));
    Ok(())
}

fn create_nullifier(
    payer: &AccountView,
    nullifier_account: &AccountView,
    system: &AccountView,
    program_id: &Address,
    nullifier: &[u8; 32],
    bump: u8,
) -> ProgramResult {
    let bump_seed = [bump];
    let seeds = [
        Seed::from(NULLIFIER_SEED),
        Seed::from(nullifier.as_slice()),
        Seed::from(&bump_seed),
    ];
    create_account(
        payer,
        nullifier_account,
        system,
        rent_exempt(0),
        0,
        program_id,
        &seeds,
    )
}

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

fn is_fresh(account: &AccountView, program_id: &Address) -> bool {
    !account.owned_by(program_id) && account.lamports() == 0 && account.data_len() == 0
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
