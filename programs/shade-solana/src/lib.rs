//! Devnet Shade program. The Groth16 verifying key is a single-party setup
//! (`insecure-test-setup`). Do not deploy it beyond devnet.
#![allow(unexpected_cfgs)]

use pinocchio::{account::AccountView, address::Address, entrypoint, error::ProgramError, ProgramResult};

mod verifying_key;

entrypoint!(process_instruction);

/// Instruction tag 1: shielded transfer.
/// Layout: tag || proof_a(64) || proof_b(128) || proof_c(64) || public_inputs(5 * 32)
pub fn process_instruction(
    _program_id: &Address,
    _accounts: &[AccountView],
    data: &[u8],
) -> ProgramResult {
    if data.first() != Some(&1) || data.len() != 1 + 64 + 128 + 64 + 5 * 32 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let proof_a: &[u8; 64] = data[1..65].try_into().unwrap();
    let proof_b: &[u8; 128] = data[65..193].try_into().unwrap();
    let proof_c: &[u8; 64] = data[193..257].try_into().unwrap();
    let mut public_inputs = [[0u8; 32]; 5];
    for (index, chunk) in data[257..].chunks(32).enumerate() {
        public_inputs[index].copy_from_slice(chunk);
    }
    verify(proof_a, proof_b, proof_c, &public_inputs)
}

fn verify(
    proof_a: &[u8; 64],
    proof_b: &[u8; 128],
    proof_c: &[u8; 64],
    public_inputs: &[[u8; 32]; 5],
) -> ProgramResult {
    #[cfg(target_os = "solana")]
    {
        use groth16_solana::groth16::Groth16Verifier;
        let mut verifier = Groth16Verifier::new(
            proof_a,
            proof_b,
            proof_c,
            public_inputs,
            &verifying_key::VERIFYINGKEY,
        )
        .map_err(|_| ProgramError::InvalidInstructionData)?;
        verifier.verify().map_err(|_| ProgramError::InvalidAccountData)?;
        Ok(())
    }
    #[cfg(not(target_os = "solana"))]
    {
        let _ = (proof_a, proof_b, proof_c, public_inputs);
        Err(ProgramError::InvalidAccountData)
    }
}
