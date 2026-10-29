mod groth16;
mod merkle;

pub use groth16::{verify_snarkjs, SnarkjsProof, VerifyingKeyJson};
pub use merkle::{
    domain_commitment, domain_nullifier, domain_owner, field_from_dec, fr_to_dec, fr_to_u128, insert,
    zero_hashes, DEPTH,
};

pub use ark_bn254::Fr;

pub fn commitment(value: Fr, blinding: Fr, rho: Fr, owner: Fr, asset: Fr) -> Fr {
    merkle::hash6(&[domain_commitment(), value, blinding, rho, owner, asset])
}

pub fn owner_address(spending_key: Fr) -> Fr {
    merkle::hash2(domain_owner(), spending_key)
}

pub fn nullifier(spending_key: Fr, rho: Fr) -> Fr {
    merkle::hash3(domain_nullifier(), spending_key, rho)
}
