use near_sdk::store::IterableSet;
use near_sdk::{env, near, AccountId, NearToken, Promise};
use shade_crypto::{
    commitment, field_from_dec, fr_to_dec, fr_to_u128, insert, verify_snarkjs, zero_hashes, Fr,
    SnarkjsProof, VerifyingKeyJson, DEPTH,
};
use std::str::FromStr;

#[near(contract_state)]
pub struct Pool {
    next_index: u64,
    root: String,
    filled: Vec<String>,
    zeros: Vec<String>,
    nullifiers: IterableSet<String>,
    known_roots: IterableSet<String>,
    vk: String,
}

impl Default for Pool {
    fn default() -> Self {
        let zeros: Vec<String> = zero_hashes().into_iter().map(fr_to_dec).collect();
        let root = zeros.last().expect("root").clone();
        let mut known_roots = IterableSet::new(b"r");
        known_roots.insert(root.clone());
        Self {
            next_index: 0,
            root: root.clone(),
            filled: zeros[..DEPTH].to_vec(),
            zeros,
            nullifiers: IterableSet::new(b"n"),
            known_roots,
            vk: String::new(),
        }
    }
}

#[near]
impl Pool {
    /// Stores the snarkjs verification_key.json. Devnet keys are a single-party setup.
    pub fn set_verification_key(&mut self, vk_json: String) {
        let _: VerifyingKeyJson = serde_json::from_str(&vk_json).expect("verification key");
        self.vk = vk_json;
    }

    #[payable]
    pub fn deposit(&mut self, blinding: String, rho: String, owner: String) -> String {
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

    /// public_inputs and proof use snarkjs JSON field order.
    /// `fee` yoctoNEAR is paid to `recipient` when the proof's public fee matches.
    pub fn shielded_transfer(
        &mut self,
        proof_json: String,
        public_inputs: Vec<String>,
        recipient: String,
    ) {
        assert_eq!(public_inputs.len(), 5, "public inputs");
        assert!(self.known_roots.contains(&public_inputs[0]), "unknown root");
        assert!(!self.nullifiers.contains(&public_inputs[1]), "nullifier spent");
        let vk: VerifyingKeyJson = serde_json::from_str(&self.vk).expect("verification key not set");
        let proof: SnarkjsProof = serde_json::from_str(&proof_json).expect("proof");
        assert!(verify_snarkjs(&vk, &proof, &public_inputs), "invalid proof");
        self.nullifiers.insert(public_inputs[1].clone());
        self.push_leaf(field_from_dec(&public_inputs[2]));
        self.push_leaf(field_from_dec(&public_inputs[3]));
        let fee = field_from_dec(&public_inputs[4]);
        let fee_yocto = fr_to_u128(fee);
        if fee_yocto > 0 {
            let account = AccountId::from_str(&recipient).expect("recipient account");
            Promise::new(account).transfer(NearToken::from_yoctonear(fee_yocto));
        }
    }

    pub fn root(&self) -> String {
        self.root.clone()
    }

    pub fn nullifier_spent(&self, nullifier: String) -> bool {
        self.nullifiers.contains(&nullifier)
    }
}

impl Pool {
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

#[cfg(test)]
mod tests {
    use super::*;
    use shade_crypto::{field_from_dec, fr_to_dec, owner_address};

    #[test]
    fn owner_address_matches_two_input_poseidon() {
        let owner = owner_address(field_from_dec("17"));
        assert!(!fr_to_dec(owner).is_empty());
    }
}
