//! LiteSVM test of the devnet pool: deposit, a real Groth16 proof, withdraw,
//! then reject a reused nullifier and an unknown root.

use shade_solana::{
    rent_exempt, DEPOSIT_LEN, ERR_NULLIFIER_SPENT, ERR_UNKNOWN_ROOT, IX_INIT, NULLIFIER_SEED, POOL_LEN, POOL_SEED,
    VAULT_SEED, WITHDRAW_LEN,
};
use solana_address::Address;
use solana_instruction::{account_meta::AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_message::Message;
use solana_sdk_ids::system_program;
use solana_signer::Signer;
use solana_transaction::Transaction;
use solana_transaction_error::TransactionError;
use std::path::PathBuf;
use std::sync::OnceLock;

const FQ: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x97, 0x81, 0x6a, 0x91, 0x68, 0x71, 0xca, 0x8d, 0x3c, 0x20, 0x8c, 0x16, 0xd8, 0x7c, 0xfd, 0x47,
];

fn fixture() -> &'static serde_json::Value {
    static FIXTURE: OnceLock<serde_json::Value> = OnceLock::new();
    FIXTURE.get_or_init(|| {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        let output = std::process::Command::new("node")
            .arg("scripts/evm-proof.mjs")
            .current_dir(&root)
            .output()
            .expect("node is required to build the devnet proof");
        assert!(
            output.status.success(),
            "evm-proof failed\n{}",
            String::from_utf8_lossy(&output.stderr)
        );
        serde_json::from_slice(&output.stdout).expect("proof json")
    })
}

fn be32_dec(value: &str) -> [u8; 32] {
    let mut out = [0u8; 32];
    for byte in value.bytes() {
        assert!(byte.is_ascii_digit(), "non-digit in field element");
        let mut carry = (byte - b'0') as u16;
        for limb in out.iter_mut().rev() {
            let wide = u16::from(*limb) * 10 + carry;
            *limb = (wide & 0xff) as u8;
            carry = wide >> 8;
        }
        assert_eq!(carry, 0, "field element does not fit in 32 bytes");
    }
    out
}

fn sub_fq(value: &[u8; 32]) -> [u8; 32] {
    if *value == [0u8; 32] {
        return *value;
    }
    let mut out = [0u8; 32];
    let mut borrow = 0i16;
    for index in (0..32).rev() {
        let diff = i16::from(FQ[index]) - i16::from(value[index]) - borrow;
        if diff < 0 {
            out[index] = (diff + 256) as u8;
            borrow = 1;
        } else {
            out[index] = diff as u8;
            borrow = 0;
        }
    }
    assert_eq!(borrow, 0);
    out
}

fn encode_deposit(payload: &serde_json::Value) -> Vec<u8> {
    let mut data = vec![2u8];
    data.extend(be32_dec(payload["blinding"].as_str().unwrap()));
    data.extend(be32_dec(payload["rho"].as_str().unwrap()));
    data.extend(be32_dec(payload["owner"].as_str().unwrap()));
    let value: u64 = payload["value"].as_str().unwrap().parse().unwrap();
    data.extend(value.to_le_bytes());
    assert_eq!(data.len(), DEPOSIT_LEN);
    data
}

fn encode_withdraw(payload: &serde_json::Value) -> Vec<u8> {
    let mut data = vec![1u8];
    let proof_a = payload["pA"].as_array().unwrap();
    let x = be32_dec(proof_a[0].as_str().unwrap());
    let y = be32_dec(proof_a[1].as_str().unwrap());
    data.extend(x);
    data.extend(sub_fq(&y));
    for row in payload["pB"].as_array().unwrap() {
        let row = row.as_array().unwrap();
        data.extend(be32_dec(row[0].as_str().unwrap()));
        data.extend(be32_dec(row[1].as_str().unwrap()));
    }
    let proof_c = payload["pC"].as_array().unwrap();
    data.extend(be32_dec(proof_c[0].as_str().unwrap()));
    data.extend(be32_dec(proof_c[1].as_str().unwrap()));
    for signal in payload["pub"].as_array().unwrap() {
        data.extend(be32_dec(signal.as_str().unwrap()));
    }
    assert_eq!(data.len(), WITHDRAW_LEN);
    data
}

fn send(svm: &mut litesvm::LiteSVM, payer: &Keypair, instructions: &[Instruction]) -> Result<litesvm::types::TransactionMetadata, litesvm::types::FailedTransactionMetadata> {
    let message = Message::new_with_blockhash(instructions, Some(&payer.pubkey()), &svm.latest_blockhash());
    let transaction = Transaction::new(&[payer], message, svm.latest_blockhash());
    svm.send_transaction(transaction)
}

fn expect_ok(result: Result<litesvm::types::TransactionMetadata, litesvm::types::FailedTransactionMetadata>, label: &str) {
    if let Err(failed) = &result {
        panic!("{label} failed: {:?}\n{}", failed.err, failed.meta.pretty_logs());
    }
}

fn custom_code(err: &TransactionError) -> Option<u32> {
    match err {
        TransactionError::InstructionError(_, solana_instruction_error::InstructionError::Custom(code)) => Some(*code),
        _ => None,
    }
}

#[test]
fn deposit_proves_and_withdraws_once() {
    let payload = fixture();
    let mut svm = litesvm::LiteSVM::new();
    let program_id = Keypair::new().pubkey();
    let so_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/deploy/shade_solana.so");
    svm.add_program_from_file(program_id, &so_path)
        .unwrap_or_else(|err| panic!("load {} ({err}). Run cargo-build-sbf --features insecure-test-setup", so_path.display()));

    let payer = Keypair::new();
    let recipient = Keypair::new().pubkey();
    svm.airdrop(&payer.pubkey(), 2_000_000_000).unwrap();
    svm.airdrop(&recipient, 1_000_000_000).unwrap();

    let (pool, _) = Address::find_program_address(&[POOL_SEED], &program_id);
    let (vault, _) = Address::find_program_address(&[VAULT_SEED], &program_id);
    let system = system_program::id();

    let init = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(payer.pubkey(), true),
            AccountMeta::new(pool, false),
            AccountMeta::new(vault, false),
            AccountMeta::new_readonly(system, false),
        ],
        data: vec![IX_INIT],
    };
    expect_ok(send(&mut svm, &payer, &[init]), "initialize");
    let pool_account = svm.get_account(&pool).expect("pool");
    assert_eq!(pool_account.data.len(), POOL_LEN);
    assert_eq!(pool_account.owner, program_id);
    assert!(pool_account.lamports >= rent_exempt(POOL_LEN as u64));
    let vault_before = svm.get_account(&vault).expect("vault").lamports;

    let deposit = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(payer.pubkey(), true),
            AccountMeta::new(pool, false),
            AccountMeta::new(vault, false),
            AccountMeta::new_readonly(system, false),
        ],
        data: encode_deposit(payload),
    };
    expect_ok(send(&mut svm, &payer, &[deposit]), "deposit");
    let value: u64 = payload["value"].as_str().unwrap().parse().unwrap();
    assert_eq!(svm.get_account(&vault).unwrap().lamports, vault_before + value);
    let root = be32_dec(payload["root"].as_str().unwrap());
    let pool_data = svm.get_account(&pool).unwrap().data;
    assert_eq!(&pool_data[20..52], &root);
    assert_eq!(u64::from_le_bytes(pool_data[12..20].try_into().unwrap()), 1);

    let nullifier = be32_dec(payload["nullifier"].as_str().unwrap());
    let (nullifier_pda, _) = Address::find_program_address(&[NULLIFIER_SEED, &nullifier], &program_id);
    let withdraw_accounts = vec![
        AccountMeta::new(payer.pubkey(), true),
        AccountMeta::new(pool, false),
        AccountMeta::new(vault, false),
        AccountMeta::new(nullifier_pda, false),
        AccountMeta::new(recipient, false),
        AccountMeta::new_readonly(system, false),
    ];
    let mut unknown = encode_withdraw(payload);
    unknown[257..289].fill(2);
    let rejected = send(
        &mut svm,
        &payer,
        &[Instruction {
            program_id,
            accounts: withdraw_accounts.clone(),
            data: unknown,
        }],
    );
    let err = rejected.expect_err("unknown root must fail").err;
    assert_eq!(custom_code(&err), Some(ERR_UNKNOWN_ROOT), "{err:?}");

    let recipient_before = svm.get_account(&recipient).unwrap().lamports;
    expect_ok(
        send(
            &mut svm,
            &payer,
            &[Instruction {
                program_id,
                accounts: withdraw_accounts.clone(),
                data: encode_withdraw(payload),
            }],
        ),
        "withdraw",
    );
    assert_eq!(svm.get_account(&recipient).unwrap().lamports, recipient_before + value);
    assert_eq!(svm.get_account(&vault).unwrap().lamports, vault_before);
    let spent = svm.get_account(&nullifier_pda).expect("nullifier pda");
    assert_eq!(spent.owner, program_id);
    assert_eq!(u64::from_le_bytes(svm.get_account(&pool).unwrap().data[12..20].try_into().unwrap()), 3);

    svm.expire_blockhash();
    let reused = send(
        &mut svm,
        &payer,
        &[Instruction {
            program_id,
            accounts: withdraw_accounts,
            data: encode_withdraw(payload),
        }],
    );
    let err = reused.expect_err("reused nullifier must fail").err;
    assert_eq!(custom_code(&err), Some(ERR_NULLIFIER_SPENT), "{err:?}");
}
