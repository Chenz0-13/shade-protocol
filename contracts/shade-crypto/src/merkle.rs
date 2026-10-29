use ark_bn254::Fr;
use light_poseidon::{Poseidon, PoseidonHasher};
use std::str::FromStr;

pub const DEPTH: usize = 8;

pub fn domain_commitment() -> Fr {
    Fr::from(1u64)
}
pub fn domain_nullifier() -> Fr {
    Fr::from(2u64)
}
pub fn domain_owner() -> Fr {
    Fr::from(3u64)
}

pub fn field_from_dec(value: &str) -> Fr {
    Fr::from_str(value).unwrap_or_else(|_| panic!("field element is not decimal"))
}

pub fn fr_to_dec(value: Fr) -> String {
    use ark_ff::{BigInteger, PrimeField};
    value.into_bigint().to_string()
}

pub fn fr_to_u128(value: Fr) -> u128 {
    use ark_ff::{BigInteger, PrimeField};
    let bytes = value.into_bigint().to_bytes_le();
    let mut acc = 0u128;
    for (index, byte) in bytes.iter().take(16).enumerate() {
        acc |= (*byte as u128) << (8 * index);
    }
    acc
}

pub fn hash2(left: Fr, right: Fr) -> Fr {
    let mut poseidon = Poseidon::<Fr>::new_circom(2).expect("poseidon2");
    poseidon.hash(&[left, right]).expect("hash2")
}

pub fn hash3(a: Fr, b: Fr, c: Fr) -> Fr {
    let mut poseidon = Poseidon::<Fr>::new_circom(3).expect("poseidon3");
    poseidon.hash(&[a, b, c]).expect("hash3")
}

pub fn hash6(inputs: &[Fr; 6]) -> Fr {
    let mut poseidon = Poseidon::<Fr>::new_circom(6).expect("poseidon6");
    poseidon.hash(inputs).expect("hash6")
}

pub fn zero_hashes() -> Vec<Fr> {
    let mut zeros = vec![Fr::from(0u64)];
    for _ in 0..DEPTH {
        let last = *zeros.last().expect("zero");
        zeros.push(hash2(last, last));
    }
    zeros
}

/// Frontier insert. Returns the new root. `filled` and `zeros` are length DEPTH.
pub fn insert(filled: &mut [Fr], zeros: &[Fr], next_index: u64, leaf: Fr) -> (Fr, u64) {
    assert!(filled.len() == DEPTH && zeros.len() == DEPTH + 1);
    assert!(next_index < 1 << DEPTH);
    let mut index = next_index;
    let mut current = leaf;
    for level in 0..DEPTH {
        if index % 2 == 0 {
            filled[level] = current;
            current = hash2(current, zeros[level]);
        } else {
            current = hash2(filled[level], current);
        }
        index /= 2;
    }
    (current, next_index + 1)
}

