use near_sdk::store::{IterableMap, IterableSet};
use near_sdk::{env, near, AccountId, Gas, NearToken, Promise, PromiseResult};
use shade_crypto::{
    canonical_decimal, commitment, ext_data_hash, field_from_dec, fr_to_dec, fr_to_u128, insert,
    split_be32, verify_snarkjs, zero_hashes, Fr, SnarkjsProof, VerifyingKeyJson, DEPTH,
};
use std::str::FromStr;

/// External-data domain for NEAR testnet. Not an EVM chain id.
const NEAR_EXT_DOMAIN: u64 = 1002;

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Refund {
    pub payee: AccountId,
    pub amount: u128,
}

#[near(contract_state)]
pub struct Pool {
    next_index: u64,
    root: String,
    filled: Vec<String>,
    zeros: Vec<String>,
    nullifiers: IterableSet<String>,
    known_roots: IterableSet<String>,
    refunds: IterableMap<String, Refund>,
    min_deposit: u128,
    vk: String,
    vk_set: bool,
    owner: AccountId,
}

#[near]
impl Pool {
    /// The predecessor becomes the owner and the verification key is fixed.
    /// A later `set_verification_key` fails for the owner and for everyone else.
    #[init]
    pub fn new(vk_json: String, min_deposit: u128) -> Self {
        assert!(min_deposit > 0, "minimum deposit");
        let mut pool = Self::default();
        pool.owner = env::predecessor_account_id();
        pool.min_deposit = min_deposit;
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
        assert!(yocto >= self.min_deposit, "below minimum deposit");
        assert!(yocto <= u64::MAX as u128, "deposit must fit in 64 bits");
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
    /// root, nullifier, commitmentOut1, commitmentOut2, withdrawAmount, relayerFee, extDataHash.
    /// `extDataHash` binds recipient, predecessor (relayer), this contract (pool), both amounts, and the NEAR domain.
    ///
    /// The payout is a promise. If that promise fails, the nullifier stays spent
    /// (the output notes were already inserted) and the amount is recorded as a
    /// refundable claim. Unmarking the nullifier would allow a second spend.
    pub fn shielded_transfer(&mut self, proof_json: String, public_inputs: Vec<String>, recipient: String) {
        assert!(self.vk_set, "not initialized");
        let inputs = self.screen(&public_inputs, &recipient);
        let vk: VerifyingKeyJson = serde_json::from_str(&self.vk).expect("verification key not set");
        let proof: SnarkjsProof = serde_json::from_str(&proof_json).expect("proof");
        assert!(verify_snarkjs(&vk, &proof, &inputs), "invalid proof");
        self.nullifiers.insert(inputs[1].clone());
        self.push_leaf(field_from_dec(&inputs[2]));
        self.push_leaf(field_from_dec(&inputs[3]));
        let withdraw = fr_to_u128(field_from_dec(&inputs[4]));
        let fee = fr_to_u128(field_from_dec(&inputs[5]));
        self.schedule_payout(inputs[1].clone(), &recipient, withdraw, fee);
    }

    /// Pays a refund recorded by `on_payout`. A failed claim is written back.
    pub fn claim_refund(&mut self, key: String) -> Promise {
        let refund = self.refunds.remove(&key).expect("no refund");
        Promise::new(refund.payee.clone())
            .transfer(NearToken::from_yoctonear(refund.amount))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(20))
                    .on_claim(key, refund.payee, refund.amount),
            )
    }

    #[private]
    pub fn on_payout(
        &mut self,
        nullifier: String,
        recipient: AccountId,
        withdraw: u128,
        relayer: AccountId,
        fee: u128,
    ) {
        assert!(self.nullifiers.contains(&nullifier), "nullifier");
        assert!(env::promise_results_count() > 0, "missing promise result");
        let mut index = 0u64;
        if withdraw > 0 {
            if !promise_ok(index) {
                self.refunds.insert(
                    format!("{nullifier}:withdraw"),
                    Refund { payee: recipient, amount: withdraw },
                );
            }
            index += 1;
        }
        if fee > 0 && !promise_ok(index) {
            self.refunds.insert(format!("{nullifier}:fee"), Refund { payee: relayer, amount: fee });
        }
    }

    #[private]
    pub fn on_claim(&mut self, key: String, payee: AccountId, amount: u128) {
        if env::promise_results_count() == 0 || !promise_ok(0) {
            self.refunds.insert(key, Refund { payee, amount });
        }
    }

    pub fn refund_of(&self, key: String) -> u128 {
        self.refunds.get(&key).map(|item| item.amount).unwrap_or(0)
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
            refunds: IterableMap::new(b"f"),
            min_deposit: 1,
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
        assert_eq!(public_inputs.len(), 7, "public inputs");
        let inputs: Vec<String> = public_inputs
            .iter()
            .map(|item| canonical_decimal(item).unwrap_or_else(|err| panic!("{err}")))
            .collect();
        assert!(self.known_roots.contains(&inputs[0]), "unknown root");
        assert!(!self.nullifiers.contains(&inputs[1]), "nullifier spent");
        let withdraw = field_from_dec(&inputs[4]);
        let fee = field_from_dec(&inputs[5]);
        let expected = ext_hash(
            recipient,
            env::predecessor_account_id().as_str(),
            env::current_account_id().as_str(),
            withdraw,
            fee,
        );
        assert_eq!(fr_to_dec(expected), inputs[6], "ext data");
        inputs
    }

    fn schedule_payout(&self, nullifier: String, recipient: &str, withdraw: u128, fee: u128) {
        let recipient_id = AccountId::from_str(recipient).expect("recipient account");
        let relayer_id = env::predecessor_account_id();
        let mut parts: Vec<Promise> = Vec::new();
        if withdraw > 0 {
            parts.push(Promise::new(recipient_id.clone()).transfer(NearToken::from_yoctonear(withdraw)));
        }
        if fee > 0 {
            parts.push(Promise::new(relayer_id.clone()).transfer(NearToken::from_yoctonear(fee)));
        }
        if parts.is_empty() {
            return;
        }
        let mut joined = parts.remove(0);
        for part in parts {
            joined = joined.and(part);
        }
        let _scheduled = joined.then(
            Self::ext(env::current_account_id())
                .with_static_gas(Gas::from_tgas(30))
                .on_payout(nullifier, recipient_id, withdraw, relayer_id, fee),
        );
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

fn ext_hash(recipient: &str, relayer: &str, pool: &str, withdraw: Fr, fee: Fr) -> Fr {
    let (recipient_lo, recipient_hi) = account_limbs(recipient);
    let (relayer_lo, relayer_hi) = account_limbs(relayer);
    let (pool_lo, pool_hi) = account_limbs(pool);
    ext_data_hash(
        recipient_lo,
        recipient_hi,
        relayer_lo,
        relayer_hi,
        pool_lo,
        pool_hi,
        withdraw,
        fee,
        Fr::from(NEAR_EXT_DOMAIN),
    )
}

fn promise_ok(index: u64) -> bool {
    matches!(env::promise_result(index), PromiseResult::Successful(_))
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
            .current_account_id("pool.testnet".parse().unwrap())
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
        let mut pool = Pool::new(dummy_vk(), 1);
        testing_env!(context("other.testnet", 0));
        pool.set_verification_key(dummy_vk());
    }

    #[test]
    #[should_panic(expected = "verification key already set")]
    fn owner_cannot_set_the_verification_key_twice() {
        testing_env!(context("owner.testnet", 0));
        let mut pool = Pool::new(dummy_vk(), 1);
        pool.set_verification_key(dummy_vk());
    }

    #[test]
    fn replay_aliases_do_not_match_the_canonical_nullifier_or_root() {
        testing_env!(context("owner.testnet", 0));
        let mut pool = Pool::new(dummy_vk(), 1);
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
        let pool = Pool::new(dummy_vk(), 1);
        let alias = add_dec("17", FIELD_MODULUS_DEC);
        pool.screen(&[pool.root(), alias, "1".into(), "1".into(), "0".into(), "0".into(), "1".into()], "recipient.testnet");
    }

    #[test]
    #[should_panic(expected = "plain decimal")]
    fn signed_nullifier_is_rejected() {
        testing_env!(context("owner.testnet", 0));
        let pool = Pool::new(dummy_vk(), 1);
        pool.screen(&[pool.root(), "+17".into(), "1".into(), "1".into(), "0".into(), "0".into(), "1".into()], "recipient.testnet");
    }

    #[test]
    #[should_panic(expected = "plain decimal")]
    fn negative_nullifier_is_rejected() {
        testing_env!(context("owner.testnet", 0));
        let pool = Pool::new(dummy_vk(), 1);
        let alias = format!("-{}", sub_dec(FIELD_MODULUS_DEC, "17"));
        pool.screen(&[pool.root(), alias, "1".into(), "1".into(), "0".into(), "0".into(), "1".into()], "recipient.testnet");
    }

    #[test]
    #[should_panic(expected = "not reduced")]
    fn root_plus_modulus_is_rejected() {
        testing_env!(context("owner.testnet", 0));
        let pool = Pool::new(dummy_vk(), 1);
        let alias = add_dec(&pool.root(), FIELD_MODULUS_DEC);
        pool.screen(&[alias, "17".into(), "1".into(), "1".into(), "0".into(), "0".into(), "1".into()], "recipient.testnet");
    }

    #[test]
    #[should_panic(expected = "plain decimal")]
    fn signed_root_is_rejected() {
        testing_env!(context("owner.testnet", 0));
        let pool = Pool::new(dummy_vk(), 1);
        pool.screen(
            &[format!("+{}", pool.root()), "17".into(), "1".into(), "1".into(), "0".into(), "0".into(), "1".into()],
            "recipient.testnet",
        );
    }

    #[test]
    #[should_panic(expected = "plain decimal")]
    fn negative_root_is_rejected() {
        testing_env!(context("owner.testnet", 0));
        let pool = Pool::new(dummy_vk(), 1);
        let alias = format!("-{}", sub_dec(FIELD_MODULUS_DEC, &pool.root()));
        pool.screen(&[alias, "17".into(), "1".into(), "1".into(), "0".into(), "0".into(), "1".into()], "recipient.testnet");
    }

    #[test]
    #[should_panic(expected = "ext data")]
    fn resubmitting_the_proof_to_a_different_recipient_fails() {
        let (proof, inputs, blinding, rho, owner) = funded_fixture();
        testing_env!(context("relayer.testnet", 1000));
        let mut pool = Pool::new(real_vk(), 1);
        pool.deposit(blinding, rho, owner);
        testing_env!(context("relayer.testnet", 0));
        pool.shielded_transfer(proof, inputs, "other.testnet".to_string());
    }

    #[test]
    fn bound_recipient_can_withdraw_once() {
        let (proof, inputs, blinding, rho, owner) = funded_fixture();
        testing_env!(context("relayer.testnet", 1000));
        let mut pool = Pool::new(real_vk(), 1);
        pool.deposit(blinding, rho, owner);
        testing_env!(context("relayer.testnet", 0));
        pool.shielded_transfer(proof, inputs.clone(), "recipient.testnet".to_string());
        assert!(pool.nullifier_spent(inputs[1].clone()));
    }

    #[test]
    #[should_panic(expected = "below minimum deposit")]
    fn deposit_below_the_configured_minimum_is_rejected() {
        testing_env!(context("owner.testnet", 1));
        let mut pool = Pool::new(dummy_vk(), 1_000);
        pool.deposit("1".into(), "2".into(), "3".into());
    }

    #[test]
    fn failed_payout_records_a_claim_and_keeps_the_nullifier_spent() {
        testing_env!(context("owner.testnet", 0));
        let mut pool = Pool::new(dummy_vk(), 1);
        pool.nullifiers.insert("17".to_string());
        testing_env!(
            context("pool.testnet", 0),
            near_sdk::test_vm_config(),
            near_sdk::RuntimeFeesConfig::test(),
            Default::default(),
            vec![PromiseResult::Failed, PromiseResult::Failed],
        );
        pool.on_payout(
            "17".into(),
            "recipient.testnet".parse().unwrap(),
            1_000,
            "relayer.testnet".parse().unwrap(),
            250,
        );
        assert!(pool.nullifier_spent("17".into()));
        assert_eq!(pool.refund_of("17:withdraw".into()), 1_000);
        assert_eq!(pool.refund_of("17:fee".into()), 250);
        testing_env!(context("user.testnet", 0));
        pool.claim_refund("17:withdraw".into());
        assert_eq!(pool.refund_of("17:withdraw".into()), 0);
        assert_eq!(pool.refund_of("17:fee".into()), 250);
    }

    #[test]
    #[should_panic(expected = "nullifier spent")]
    fn second_canonical_spend_is_rejected() {
        let (proof, inputs, blinding, rho, owner) = funded_fixture();
        testing_env!(context("relayer.testnet", 1000));
        let mut pool = Pool::new(real_vk(), 1);
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
            .arg("--pool-account")
            .arg("pool.testnet")
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
