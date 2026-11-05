mod groth16;
mod merkle;

pub use groth16::{verify_snarkjs, SnarkjsProof, VerifyingKeyJson};
pub use merkle::{
    canonical_decimal, domain_asset, domain_chain, domain_commitment, domain_ext, domain_nullifier, domain_owner,
    domain_rho, field_from_dec,
    fr_from_be, fr_to_dec, fr_to_u128, insert, parse_canonical_field, split_be32, zero_hashes, FIELD_MODULUS_DEC,
    DEPTH,
};

pub use ark_bn254::Fr;

pub fn asset_chain_tag(asset: Fr, chain_home: Fr) -> Fr {
    let asset_tag = merkle::hash2(domain_asset(), asset);
    let chain_tag = merkle::hash2(domain_chain(), chain_home);
    merkle::hash2(asset_tag, chain_tag)
}

pub fn commitment(value: Fr, blinding: Fr, rho: Fr, owner: Fr, asset: Fr, chain_home: Fr) -> Fr {
    merkle::hash6(&[domain_commitment(), value, blinding, rho, owner, asset_chain_tag(asset, chain_home)])
}

pub fn owner_address(spending_key: Fr) -> Fr {
    merkle::hash2(domain_owner(), spending_key)
}

/// Poseidon(domain, spending key, commitment, leaf index).
pub fn nullifier(spending_key: Fr, commitment: Fr, leaf_index: Fr) -> Fr {
    merkle::hash4(&[domain_nullifier(), spending_key, commitment, leaf_index])
}

/// Output rho is Poseidon(domain, input nullifier, output index).
pub fn derive_output_rho(nullifier_hash: Fr, output_index: u64) -> Fr {
    merkle::hash3(domain_rho(), nullifier_hash, Fr::from(output_index))
}

/// Recipient and relayer limbs, bound to a domain that includes the pool address.
pub fn ext_data_hash(
    recipient_lo: Fr,
    recipient_hi: Fr,
    relayer_lo: Fr,
    relayer_hi: Fr,
    pool_lo: Fr,
    pool_hi: Fr,
    withdraw_amount: Fr,
    relayer_fee: Fr,
    chain_domain: Fr,
) -> Fr {
    let binder = merkle::hash6(&[
        domain_ext(),
        pool_lo,
        pool_hi,
        chain_domain,
        withdraw_amount,
        relayer_fee,
    ]);
    merkle::hash6(&[recipient_lo, recipient_hi, relayer_lo, relayer_hi, binder, Fr::from(0u64)])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn duplicate_rho_notes_do_not_share_a_nullifier() {
        let key = Fr::from(17u64);
        let rho = Fr::from(13u64);
        let owner = owner_address(key);
        let first = commitment(Fr::from(5u64), Fr::from(11u64), rho, owner, Fr::from(1u64), Fr::from(1002u64));
        let second = commitment(Fr::from(5u64), Fr::from(19u64), rho, owner, Fr::from(1u64), Fr::from(1002u64));
        assert_ne!(
            first,
            commitment(Fr::from(5u64), Fr::from(11u64), rho, owner, Fr::from(1u64), Fr::from(46630u64))
        );
        let spent = nullifier(key, first, Fr::from(0u64));
        let other = nullifier(key, second, Fr::from(1u64));
        assert_ne!(spent, other);
        assert_ne!(nullifier(key, first, Fr::from(0u64)), nullifier(key, first, Fr::from(1u64)));
        let old = merkle::hash3(domain_nullifier(), key, rho);
        assert_eq!(old, merkle::hash3(domain_nullifier(), key, rho));
        assert_ne!(spent, old);
        assert_ne!(derive_output_rho(spent, 1), derive_output_rho(spent, 2));
    }
}
