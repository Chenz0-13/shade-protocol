use crate::merkle::{field_from_dec, parse_canonical_field};
use ark_bn254::{Bn254, Fq, Fq2, Fr, G1Affine, G2Affine};
use ark_groth16::{Groth16, PreparedVerifyingKey, Proof, VerifyingKey};
use serde::{Deserialize, Serialize};
use std::str::FromStr;

#[derive(Debug, Deserialize, Serialize)]
pub struct SnarkjsProof {
    #[serde(rename = "pi_a")]
    pub pi_a: Vec<String>,
    #[serde(rename = "pi_b")]
    pub pi_b: Vec<Vec<String>>,
    #[serde(rename = "pi_c")]
    pub pi_c: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct VerifyingKeyJson {
    #[serde(rename = "vk_alpha_1")]
    pub vk_alpha_1: Vec<String>,
    #[serde(rename = "vk_beta_2")]
    pub vk_beta_2: Vec<Vec<String>>,
    #[serde(rename = "vk_gamma_2")]
    pub vk_gamma_2: Vec<Vec<String>>,
    #[serde(rename = "vk_delta_2")]
    pub vk_delta_2: Vec<Vec<String>>,
    #[serde(rename = "IC")]
    pub ic: Vec<Vec<String>>,
}

fn fq(value: &str) -> Fq {
    Fq::from_str(value).expect("base field element")
}

fn g1(coords: &[String]) -> G1Affine {
    let x = fq(&coords[0]);
    let y = fq(&coords[1]);
    if !G1Affine::new_unchecked(x, y).is_on_curve() {
        panic!("G1 not on curve, x starts {}", &coords[0][..8.min(coords[0].len())]);
    }
    G1Affine::new(x, y)
}

/// snarkjs stores an Fq2 coordinate as `[c0, c1]`.
fn fq2(pair: &[String]) -> Fq2 {
    Fq2::new(fq(&pair[0]), fq(&pair[1]))
}

fn g2(coords: &[Vec<String>]) -> G2Affine {
    G2Affine::new(fq2(&coords[0]), fq2(&coords[1]))
}

pub fn verifying_key_from_json(json: &VerifyingKeyJson) -> VerifyingKey<Bn254> {
    VerifyingKey {
        alpha_g1: g1(&json.vk_alpha_1),
        beta_g2: g2(&json.vk_beta_2),
        gamma_g2: g2(&json.vk_gamma_2),
        delta_g2: g2(&json.vk_delta_2),
        gamma_abc_g1: json.ic.iter().map(|point| g1(point)).collect(),
    }
}

pub fn proof_from_json(json: &SnarkjsProof) -> Proof<Bn254> {
    Proof {
        a: g1(&json.pi_a),
        b: g2(&json.pi_b),
        c: g1(&json.pi_c),
    }
}

/// Fallible scan of a snarkjs proof JSON blob. Random bytes must return an error, not abort.
pub fn screen_proof_json(bytes: &[u8]) -> Result<(), &'static str> {
    let value: serde_json::Value = serde_json::from_slice(bytes).map_err(|_| "json")?;
    let proof = value.as_object().ok_or("object")?;
    check_g1(proof.get("pi_a").ok_or("pi_a")?)?;
    check_g2(proof.get("pi_b").ok_or("pi_b")?)?;
    check_g1(proof.get("pi_c").ok_or("pi_c")?)?;
    Ok(())
}

fn check_decimal(value: &serde_json::Value) -> Result<(), &'static str> {
    let text = value.as_str().ok_or("coord")?;
    parse_canonical_field(text).map(|_| ()).map_err(|_| "field")
}

fn check_g1(value: &serde_json::Value) -> Result<(), &'static str> {
    let coords = value.as_array().ok_or("g1")?;
    if coords.len() < 2 {
        return Err("g1");
    }
    check_decimal(&coords[0])?;
    check_decimal(&coords[1])?;
    Ok(())
}

fn check_g2(value: &serde_json::Value) -> Result<(), &'static str> {
    let rows = value.as_array().ok_or("g2")?;
    if rows.len() < 2 {
        return Err("g2");
    }
    for row in rows.iter().take(2) {
        let coords = row.as_array().ok_or("g2")?;
        if coords.len() < 2 {
            return Err("g2");
        }
        check_decimal(&coords[0])?;
        check_decimal(&coords[1])?;
    }
    Ok(())
}

pub fn verify_snarkjs(vk: &VerifyingKeyJson, proof: &SnarkjsProof, public_inputs: &[String]) -> bool {
    let key = verifying_key_from_json(vk);
    let prepared = PreparedVerifyingKey::from(key);
    let decoded = proof_from_json(proof);
    let inputs: Vec<Fr> = public_inputs.iter().map(|item| field_from_dec(item)).collect();
    Groth16::<Bn254>::verify_proof(&prepared, &decoded, &inputs).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    #[test]
    fn verifies_the_devnet_circuit_proof() {
        let output = Command::new("node")
            .arg("scripts/evm-proof.mjs")
            .current_dir(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."))
            .output()
            .expect("node");
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        let fixture: serde_json::Value = serde_json::from_slice(&output.stdout).expect("json");
        let vk: VerifyingKeyJson = serde_json::from_str(
            &std::fs::read_to_string(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../circuits/build/verification_key.json"
            ))
            .expect("vkey"),
        )
        .expect("vkey json");
        let proof = SnarkjsProof {
            pi_a: vec![
                fixture["pA"][0].as_str().unwrap().to_string(),
                fixture["pA"][1].as_str().unwrap().to_string(),
                "1".to_string(),
            ],
            pi_b: vec![
                // The fixture swaps Fq2 limbs for Solidity. Restore snarkjs order [c1, c0].
                vec![
                    fixture["pB"][0][1].as_str().unwrap().to_string(),
                    fixture["pB"][0][0].as_str().unwrap().to_string(),
                ],
                vec![
                    fixture["pB"][1][1].as_str().unwrap().to_string(),
                    fixture["pB"][1][0].as_str().unwrap().to_string(),
                ],
            ],
            pi_c: vec![
                fixture["pC"][0].as_str().unwrap().to_string(),
                fixture["pC"][1].as_str().unwrap().to_string(),
                "1".to_string(),
            ],
        };
        let public_inputs: Vec<String> = fixture["pub"]
            .as_array()
            .unwrap()
            .iter()
            .map(|item| item.as_str().unwrap().to_string())
            .collect();
        assert!(verify_snarkjs(&vk, &proof, &public_inputs));
        let encoded = serde_json::to_vec(&proof).unwrap();
        assert!(screen_proof_json(&encoded).is_ok());
        assert!(screen_proof_json(b"not json").is_err());
        assert!(screen_proof_json(br#"{"pi_a":["01","1"],"pi_b":[["1","1"],["1","1"]],"pi_c":["1","1"]}"#).is_err());
    }
}
