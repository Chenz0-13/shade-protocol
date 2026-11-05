mod groth16;
mod merkle;

pub use groth16::{verify_snarkjs, SnarkjsProof, VerifyingKeyJson};
pub use merkle::{
    canonical_decimal, domain_commitment, domain_nullifier, domain_owner, field_from_dec, fr_from_be,
    fr_to_dec, fr_to_u128, insert, parse_canonical_field, split_be32, zero_hashes, FIELD_MODULUS_DEC, DEPTH,
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

/// Poseidon(recipientLo, recipientHi, relayerLo, relayerHi, fee, chainDomain).
pub fn ext_data_hash(
    recipient_lo: Fr,
    recipient_hi: Fr,
    relayer_lo: Fr,
    relayer_hi: Fr,
    fee: Fr,
    chain_domain: Fr,
) -> Fr {
    merkle::hash6(&[recipient_lo, recipient_hi, relayer_lo, relayer_hi, fee, chain_domain])
}
