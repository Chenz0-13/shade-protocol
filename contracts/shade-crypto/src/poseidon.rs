//! Circomlib Poseidon (BN254, x^5) for the widths this pool hashes.
//!
//! `light_poseidon` compiles a parameter table for every width into the wasm.
//! That table was about 1.6 MiB and pushed `shade_near.wasm` over NEAR's
//! transaction limit. The circuit and the pool only hash 2, 3, and 6 inputs
//! (Merkle nodes, nullifiers, commitments / extDataHash). Those three tables
//! live in `params/` as 32-byte big-endian words: the MDS matrix, then the
//! round constants. The permutation is the same one circomlib and poseidon-lite use.

use ark_bn254::Fr;
use ark_ff::{Field, PrimeField};

const ROUNDS_F: usize = 8;
const ROUNDS_P: [usize; 16] = [
    56, 57, 56, 60, 60, 63, 64, 63, 60, 66, 60, 65, 70, 60, 64, 68,
];

const PARAMS_2: &[u8] = include_bytes!("params/circom_2.bin");
const PARAMS_3: &[u8] = include_bytes!("params/circom_3.bin");
const PARAMS_6: &[u8] = include_bytes!("params/circom_6.bin");

pub fn hash2(left: Fr, right: Fr) -> Fr {
    hash_inputs(&[left, right], PARAMS_2)
}

pub fn hash3(first: Fr, second: Fr, third: Fr) -> Fr {
    hash_inputs(&[first, second, third], PARAMS_3)
}

pub fn hash6(inputs: &[Fr; 6]) -> Fr {
    hash_inputs(inputs, PARAMS_6)
}

fn hash_inputs<const N: usize>(inputs: &[Fr; N], params: &[u8]) -> Fr {
    let t = N + 1;
    let rounds_p = ROUNDS_P[t - 2];
    let rounds = ROUNDS_F + rounds_p;
    let matrix_words = t * t;
    let constant_words = rounds * t;
    assert_eq!(params.len(), (matrix_words + constant_words) * 32);
    let matrix = &params[..matrix_words * 32];
    let constants = &params[matrix_words * 32..];

    // state[0] is the capacity element. Inputs are state[1..].
    let mut state = [Fr::from(0u64); 8];
    for (index, input) in inputs.iter().enumerate() {
        state[index + 1] = *input;
    }
    let mut after_sbox = [Fr::from(0u64); 8];

    for round in 0..rounds {
        let full = round < ROUNDS_F / 2 || round >= ROUNDS_F / 2 + rounds_p;
        for index in 0..t {
            let mut value = state[index] + word(constants, round * t + index);
            if full || index == 0 {
                value = pow5(value);
            }
            after_sbox[index] = value;
        }
        for row in 0..t {
            let mut acc = Fr::from(0u64);
            for col in 0..t {
                acc += word(matrix, row * t + col) * after_sbox[col];
            }
            state[row] = acc;
        }
    }
    state[0]
}

fn pow5(value: Fr) -> Fr {
    let square = value.square();
    square.square() * value
}

fn word(bytes: &[u8], index: usize) -> Fr {
    let start = index * 32;
    let mut buf = [0u8; 32];
    buf.copy_from_slice(&bytes[start..start + 32]);
    Fr::from_be_bytes_mod_order(&buf)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::merkle::{field_from_dec, fr_to_dec};
    use light_poseidon::{Poseidon, PoseidonHasher};
    use serde::Deserialize;

    #[derive(Deserialize)]
    struct Vectors {
        count: usize,
        cases: Vec<Case>,
    }

    #[derive(Deserialize)]
    struct Case {
        inputs: Vec<String>,
        hash: String,
    }

    fn hash_width(inputs: &[Fr]) -> Fr {
        match inputs {
            [a, b] => hash2(*a, *b),
            [a, b, c] => hash3(*a, *b, *c),
            [a, b, c, d, e, f] => hash6(&[*a, *b, *c, *d, *e, *f]),
            _ => panic!("unsupported width {}", inputs.len()),
        }
    }

    #[test]
    fn matches_poseidon_lite_vectors() {
        let parsed: Vectors =
            serde_json::from_str(include_str!("../testdata/poseidon-vectors.json")).unwrap();
        assert_eq!(parsed.count, parsed.cases.len());
        assert!(parsed.count >= 9);
        for case in parsed.cases {
            let inputs: Vec<Fr> = case
                .inputs
                .iter()
                .map(|item| field_from_dec(item))
                .collect();
            assert_eq!(fr_to_dec(hash_width(&inputs)), case.hash);
        }
    }

    #[test]
    fn matches_light_poseidon_circom_on_more_than_the_vectors() {
        for width in [2usize, 3, 6] {
            for seed in 0..12u64 {
                let inputs: Vec<Fr> = (0..width)
                    .map(|index| Fr::from(seed.wrapping_mul(997) + index as u64 + 1))
                    .collect();
                let mut reference = Poseidon::<Fr>::new_circom(width).expect("circom params");
                let expected = reference.hash(&inputs).expect("hash");
                assert_eq!(hash_width(&inputs), expected, "width {width} seed {seed}");
            }
            let mut wide = Vec::new();
            for index in 0..width {
                let mut bytes = [0x5au8; 32];
                bytes[31] = index as u8;
                wide.push(Fr::from_be_bytes_mod_order(&bytes));
            }
            let mut reference = Poseidon::<Fr>::new_circom(width).expect("circom params");
            assert_eq!(hash_width(&wide), reference.hash(&wide).expect("hash"));
        }
    }
}
