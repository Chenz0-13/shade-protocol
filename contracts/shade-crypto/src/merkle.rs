use ark_bn254::Fr;
use ark_ff::PrimeField;
use light_poseidon::{Poseidon, PoseidonHasher};
use std::cmp::Ordering;
use std::str::FromStr;

pub const DEPTH: usize = 8;

/// BN254 scalar modulus, decimal. Inputs greater than or equal to this alias a smaller element.
pub const FIELD_MODULUS_DEC: &str =
    "21888242871839275222246405745257275088548364400416034343698204186575808495617";

pub fn domain_commitment() -> Fr {
    Fr::from(1u64)
}
pub fn domain_nullifier() -> Fr {
    Fr::from(2u64)
}
pub fn domain_owner() -> Fr {
    Fr::from(3u64)
}

/// Accept only a canonical decimal in `0..r`: no sign, no leading zeros except `0`.
pub fn parse_canonical_field(value: &str) -> Result<Fr, &'static str> {
    if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err("field element must be plain decimal");
    }
    if value.len() > 1 && value.starts_with('0') {
        return Err("field element has a leading zero");
    }
    if cmp_decimal(value, FIELD_MODULUS_DEC) != Ordering::Less {
        return Err("field element is not reduced");
    }
    Fr::from_str(value).map_err(|_| "field element is not decimal")
}

pub fn canonical_decimal(value: &str) -> Result<String, &'static str> {
    Ok(fr_to_dec(parse_canonical_field(value)?))
}

pub fn field_from_dec(value: &str) -> Fr {
    parse_canonical_field(value).unwrap_or_else(|err| panic!("{err}"))
}

pub fn fr_from_be(bytes: &[u8]) -> Fr {
    let mut padded = [0u8; 32];
    let start = 32 - bytes.len();
    padded[start..].copy_from_slice(bytes);
    Fr::from_be_bytes_mod_order(&padded)
}

/// Split a 32-byte big-endian string into 128-bit limbs. `lo` is the last 16 bytes.
pub fn split_be32(bytes: &[u8; 32]) -> (Fr, Fr) {
    (fr_from_be(&bytes[16..]), fr_from_be(&bytes[..16]))
}

fn cmp_decimal(left: &str, right: &str) -> Ordering {
    let left = left.trim_start_matches('0');
    let right = right.trim_start_matches('0');
    let left = if left.is_empty() { "0" } else { left };
    let right = if right.is_empty() { "0" } else { right };
    left.len().cmp(&right.len()).then_with(|| left.cmp(right))
}

pub fn fr_to_dec(value: Fr) -> String {
    use ark_ff::PrimeField;
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    fn add_dec(left: &str, right: &str) -> String {
        let mut acc = vec![0u8; left.len().max(right.len()) + 1];
        for (index, byte) in left.bytes().rev().enumerate() {
            acc[index] += byte - b'0';
        }
        for (index, byte) in right.bytes().rev().enumerate() {
            acc[index] += byte - b'0';
        }
        for index in 0..acc.len() - 1 {
            if acc[index] >= 10 {
                acc[index + 1] += acc[index] / 10;
                acc[index] %= 10;
            }
        }
        while acc.len() > 1 && *acc.last().unwrap() == 0 {
            acc.pop();
        }
        acc.iter().rev().map(|digit| (digit + b'0') as char).collect()
    }

    fn sub_dec(left: &str, right: &str) -> String {
        let mut acc: Vec<i16> = left.bytes().rev().map(|byte| (byte - b'0') as i16).collect();
        for (index, byte) in right.bytes().rev().enumerate() {
            acc[index] -= (byte - b'0') as i16;
            if acc[index] < 0 {
                acc[index] += 10;
                acc[index + 1] -= 1;
            }
        }
        while acc.len() > 1 && *acc.last().unwrap() == 0 {
            acc.pop();
        }
        acc.iter().rev().map(|digit| (*digit as u8 + b'0') as char).collect()
    }

    #[test]
    fn aliases_reduce_under_fromstr_and_are_rejected() {
        let n = Fr::from(17u64);
        let canonical = fr_to_dec(n);
        let plus_modulus = add_dec(&canonical, FIELD_MODULUS_DEC);
        let signed = format!("+{canonical}");
        let negative = format!("-{}", sub_dec(FIELD_MODULUS_DEC, &canonical));
        assert_eq!(Fr::from_str(&plus_modulus).unwrap(), n);
        assert_eq!(Fr::from_str(&signed).unwrap(), n);
        assert_eq!(Fr::from_str(&negative).unwrap(), n);
        assert!(parse_canonical_field(&plus_modulus).is_err());
        assert!(parse_canonical_field(&signed).is_err());
        assert!(parse_canonical_field(&negative).is_err());
        assert!(parse_canonical_field("017").is_err());
        assert_eq!(canonical_decimal(&canonical).unwrap(), canonical);
        assert_eq!(canonical_decimal("0").unwrap(), "0");
    }
}

