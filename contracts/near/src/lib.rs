use near_sdk::store::IterableSet;
use near_sdk::{env, near, AccountId, NearToken, Promise};
use shade_crypto::{
    canonical_decimal, commitment, ext_data_hash, field_from_dec, fr_to_dec, fr_to_u128, insert,
    split_be32, verify_snarkjs, zero_hashes, Fr, SnarkjsProof, VerifyingKeyJson, DEPTH,
};
use std::str::FromStr;

/// External-data domain for NEAR testnet. Not an EVM chain id.
const NEAR_EXT_DOMAIN: u64 = 1002;

#[near(contract_state)]
pub struct Pool {
    next_index: u64,
    root: String,
    filled: Vec<String>,
    zeros: Vec<String>,
    nullifiers: IterableSet<String>,
    known_roots: IterableSet<String>,
    vk: String,
    vk_set: bool,
    owner: AccountId,
}

#[near]
impl Pool {
    /// The predecessor becomes the owner and the verification key is fixed.
    /// A later `set_verification_key` fails for the owner and for everyone else.
    #[init]
    pub fn new(vk_json: String) -> Self {
        let mut pool = Self::default();
        pool.owner = env::predecessor_account_id();
        pool.install_key(vk_json);
        pool
    }

    pub fn set_verification_key(&mut self, vk_json: String) {
        assert_eq!(env::predecessor_account_id(), self.owner, "owner");
        assert!(!self.vk_set, "verification key already set");
        self.install_key(vk_json);
    }

    #[payable]
    pub fn deposit(&mut self, blinding: String, rho: String, owner: String) -> String {
        assert!(self.vk_set, "not initialized");
        let attached = env::attached_deposit();
        let yocto = attached.as_yoctonear();
        assert!(yocto > 0 && yocto <= u64::MAX as u128, "deposit must fit in 64 bits");
        let value = field_from_dec(&yocto.to_string());
        let leaf = commitment(
            value,
            field_from_dec(&blinding),
            field_from_dec(&rho),
            field_from_dec(&owner),
            field_from_dec("1"),
        );
        self.push_leaf(leaf);
        fr_to_dec(leaf)
    }

    /// public_inputs are snarkjs order:
    /// root, nullifier, commitmentOut1, commitmentOut2, fee, extDataHash.
    /// `extDataHash` binds recipient, predecessor (relayer), fee, and the NEAR domain.
    pub fn shielded_transfer(&mut self, proof_json: String, public_inputs: Vec<String>, recipient: String) {
        assert!(self.vk_set, "not initialized");
        let inputs = self.screen(&public_inputs, &recipient);
        let vk: VerifyingKeyJson = serde_json::from_str(&self.vk).expect("verification key not set");
        let proof: SnarkjsProof = serde_json::from_str(&proof_json).expect("proof");
        assert!(verify_snarkjs(&vk, &proof, &inputs), "invalid proof");
        self.nullifiers.insert(inputs[1].clone());
        self.push_leaf(field_from_dec(&inputs[2]));
        self.push_leaf(field_from_dec(&inputs[3]));
        let fee_yocto = fr_to_u128(field_from_dec(&inputs[4]));
        if fee_yocto > 0 {
            let account = AccountId::from_str(&recipient).expect("recipient account");
            Promise::new(account).transfer(NearToken::from_yoctonear(fee_yocto));
        }
    }

    pub fn root(&self) -> String {
        self.root.clone()
    }

    pub fn nullifier_spent(&self, nullifier: String) -> bool {
        canonical_decimal(&nullifier)
            .map(|key| self.nullifiers.contains(&key))
            .unwrap_or(false)
    }
}

impl Default for Pool {
    fn default() -> Self {
        let zeros: Vec<String> = zero_hashes().into_iter().map(fr_to_dec).collect();
        let root = zeros.last().expect("root").clone();
        let mut known_roots = IterableSet::new(b"r");
        known_roots.insert(root.clone());
        Self {
            next_index: 0,
            root,
            filled: zeros[..DEPTH].to_vec(),
            zeros,
            nullifiers: IterableSet::new(b"n"),
            known_roots,
            vk: String::new(),
            vk_set: false,
            owner: "shade-uninitialized.near".parse().unwrap(),
        }
    }
}

impl Pool {
    fn install_key(&mut self, vk_json: String) {
        let _: VerifyingKeyJson = serde_json::from_str(&vk_json).expect("verification key");
        self.vk = vk_json;
        self.vk_set = true;
    }

    fn screen(&self, public_inputs: &[String], recipient: &str) -> Vec<String> {
        assert_eq!(public_inputs.len(), 6, "public inputs");
        let inputs: Vec<String> = public_inputs
            .iter()
            .map(|item| canonical_decimal(item).unwrap_or_else(|err| panic!("{err}")))
            .collect();
        assert!(self.known_roots.contains(&inputs[0]), "unknown root");
        assert!(!self.nullifiers.contains(&inputs[1]), "nullifier spent");
        let fee = field_from_dec(&inputs[4]);
        let expected = ext_hash(recipient, env::predecessor_account_id().as_str(), fee);
        assert_eq!(fr_to_dec(expected), inputs[5], "ext data");
        inputs
    }

    fn push_leaf(&mut self, leaf: Fr) {
        let mut filled: Vec<Fr> = self.filled.iter().map(|item| field_from_dec(item)).collect();
        let zeros: Vec<Fr> = self.zeros.iter().map(|item| field_from_dec(item)).collect();
        let (root, next) = insert(&mut filled, &zeros, self.next_index, leaf);
        self.filled = filled.into_iter().map(fr_to_dec).collect();
        self.next_index = next;
        self.root = fr_to_dec(root);
        self.known_roots.insert(self.root.clone());
    }
}

fn ext_hash(recipient: &str, relayer: &str, fee: Fr) -> Fr {
    let (recipient_lo, recipient_hi) = account_limbs(recipient);
    let (relayer_lo, relayer_hi) = account_limbs(relayer);
    ext_data_hash(
        recipient_lo,
        recipient_hi,
        relayer_lo,
        relayer_hi,
        fee,
        Fr::from(NEAR_EXT_DOMAIN),
    )
}

fn account_limbs(account: &str) -> (Fr, Fr) {
    let digest = env::sha256(account.as_bytes());
    let bytes: [u8; 32] = digest.try_into().expect("sha256");
    split_be32(&bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::{testing_env, NearToken};
    use shade_crypto::{field_from_dec, fr_to_dec, owner_address, parse_canonical_field, FIELD_MODULUS_DEC};
    fn context(predecessor: &str, attached: u128) -> near_sdk::VMContext {
        VMContextBuilder::new()
            .predecessor_account_id(predecessor.parse().unwrap())
            .attached_deposit(NearToken::from_yoctonear(attached))
            .account_balance(NearToken::from_near(50))
            .build()
    }

    fn dummy_vk() -> String {
        r#"{"vk_alpha_1":["1","2"],"vk_beta_2":[["1","0"],["0","1"]],"vk_gamma_2":[["1","0"],["0","1"]],"vk_delta_2":[["1","0"],["0","1"]],"IC":[["1","2"]]}"#
            .to_string()
    }

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

    fn aliases(canonical: &str) -> [String; 3] {
        [
            add_dec(canonical, FIELD_MODULUS_DEC),
            format!("+{canonical}"),
            format!("-{}", sub_dec(FIELD_MODULUS_DEC, canonical)),
        ]
    }

    #[test]
    fn owner_address_matches_two_input_poseidon() {
        let owner = owner_address(field_from_dec("17"));
        assert!(!fr_to_dec(owner).is_empty());
    }

    #[test]
    #[should_panic(expected = "owner")]
    fn non_owner_cannot_set_the_verification_key() {
        testing_env!(context("owner.testnet", 0));
        let mut pool = Pool::new(dummy_vk());
        testing_env!(context("other.testnet", 0));
        pool.set_verification_key(dummy_vk());
    }

    #[test]
    #[should_panic(expected = "verification key already set")]
    fn owner_cannot_set_the_verification_key_twice() {
        testing_env!(context("owner.testnet", 0));
        let mut pool = Pool::new(dummy_vk());
        pool.set_verification_key(dummy_vk());
    }

    #[test]
    fn replay_aliases_do_not_match_the_canonical_nullifier_or_root() {
        testing_env!(context("owner.testnet", 0));
        let mut pool = Pool::new(dummy_vk());
        let root = pool.root();
        pool.nullifiers.insert("17".to_string());
        assert!(pool.nullifier_spent("17".to_string()));
        for alias in aliases("17") {
            assert!(parse_canonical_field(&alias).is_err(), "{alias}");
            assert!(!pool.nullifiers.contains(&alias), "{alias}");
        }
        for alias in aliases(&root) {
            assert!(parse_canonical_field(&alias).is_err(), "{alias}");
            assert!(!pool.known_roots.contains(&alias), "{alias}");
            assert!(pool.known_roots.contains(&root));
        }
    }

    #[test]
    #[should_panic(expected = "not reduced")]
    fn nullifier_plus_modulus_is_rejected() {
        testing_env!(context("owner.testnet", 0));
        let pool = Pool::new(dummy_vk());
        let alias = add_dec("17", FIELD_MODULUS_DEC);
        pool.screen(&[pool.root(), alias, "1".into(), "1".into(), "0".into(), "1".into()], "recipient.testnet");
    }

    #[test]
    #[should_panic(expected = "plain decimal")]
    fn signed_nullifier_is_rejected() {
        testing_env!(context("owner.testnet", 0));
        let pool = Pool::new(dummy_vk());
        pool.screen(&[pool.root(), "+17".into(), "1".into(), "1".into(), "0".into(), "1".into()], "recipient.testnet");
    }

    #[test]
    #[should_panic(expected = "plain decimal")]
    fn negative_nullifier_is_rejected() {
        testing_env!(context("owner.testnet", 0));
        let pool = Pool::new(dummy_vk());
        let alias = format!("-{}", sub_dec(FIELD_MODULUS_DEC, "17"));
        pool.screen(&[pool.root(), alias, "1".into(), "1".into(), "0".into(), "1".into()], "recipient.testnet");
    }

    #[test]
    #[should_panic(expected = "not reduced")]
    fn root_plus_modulus_is_rejected() {
        testing_env!(context("owner.testnet", 0));
        let pool = Pool::new(dummy_vk());
        let alias = add_dec(&pool.root(), FIELD_MODULUS_DEC);
        pool.screen(&[alias, "17".into(), "1".into(), "1".into(), "0".into(), "1".into()], "recipient.testnet");
    }

    #[test]
    #[should_panic(expected = "plain decimal")]
    fn signed_root_is_rejected() {
        testing_env!(context("owner.testnet", 0));
        let pool = Pool::new(dummy_vk());
        pool.screen(
            &[format!("+{}", pool.root()), "17".into(), "1".into(), "1".into(), "0".into(), "1".into()],
            "recipient.testnet",
        );
    }

    #[test]
    #[should_panic(expected = "plain decimal")]
    fn negative_root_is_rejected() {
        testing_env!(context("owner.testnet", 0));
        let pool = Pool::new(dummy_vk());
        let alias = format!("-{}", sub_dec(FIELD_MODULUS_DEC, &pool.root()));
        pool.screen(&[alias, "17".into(), "1".into(), "1".into(), "0".into(), "1".into()], "recipient.testnet");
    }

    #[test]
    #[should_panic(expected = "ext data")]
    fn resubmitting_the_proof_to_a_different_recipient_fails() {
        let (proof, inputs, blinding, rho, owner) = funded_fixture();
        testing_env!(context("relayer.testnet", 1000));
        let mut pool = Pool::new(real_vk());
        pool.deposit(blinding, rho, owner);
        testing_env!(context("relayer.testnet", 0));
        pool.shielded_transfer(proof, inputs, "other.testnet".to_string());
    }

    #[test]
    fn bound_recipient_can_withdraw_once() {
        let (proof, inputs, blinding, rho, owner) = funded_fixture();
        testing_env!(context("relayer.testnet", 1000));
        let mut pool = Pool::new(real_vk());
        pool.deposit(blinding, rho, owner);
        testing_env!(context("relayer.testnet", 0));
        pool.shielded_transfer(proof, inputs.clone(), "recipient.testnet".to_string());
        assert!(pool.nullifier_spent(inputs[1].clone()));
    }

    #[test]
    #[should_panic(expected = "nullifier spent")]
    fn second_canonical_spend_is_rejected() {
        let (proof, inputs, blinding, rho, owner) = funded_fixture();
        testing_env!(context("relayer.testnet", 1000));
        let mut pool = Pool::new(real_vk());
        pool.deposit(blinding, rho, owner);
        testing_env!(context("relayer.testnet", 0));
        pool.shielded_transfer(proof.clone(), inputs.clone(), "recipient.testnet".to_string());
        pool.shielded_transfer(proof, inputs, "recipient.testnet".to_string());
    }
}

#[cfg(test)]
fn real_vk() -> String {
    std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../circuits/build/verification_key.json"
    ))
    .expect("verification key")
}

#[cfg(test)]
fn funded_fixture() -> (String, Vec<String>, String, String, String) {
    use std::sync::OnceLock;
    static FIXTURE: OnceLock<serde_json::Value> = OnceLock::new();
    let fixture = FIXTURE.get_or_init(|| {
        let output = std::process::Command::new("node")
            .arg("scripts/evm-proof.mjs")
            .arg("--recipient-account")
            .arg("recipient.testnet")
            .arg("--relayer-account")
            .arg("relayer.testnet")
            .arg("--domain")
            .arg("1002")
            .current_dir(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."))
            .output()
            .expect("node");
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        serde_json::from_slice(&output.stdout).expect("json")
    });
    let proof = serde_json::to_string(&fixture["snarkjs"]).unwrap();
    let inputs = fixture["pub"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item.as_str().unwrap().to_string())
        .collect();
    (
        proof,
        inputs,
        fixture["blinding"].as_str().unwrap().to_string(),
        fixture["rho"].as_str().unwrap().to_string(),
        fixture["owner"].as_str().unwrap().to_string(),
    )
}
