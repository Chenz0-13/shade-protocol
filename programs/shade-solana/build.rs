use groth16_solana::vk::circom::generate_vk_file;
use groth16_solana::vk::setup::{ProvingKeySource, SetupKind};
use std::path::Path;

fn main() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let vkey = root.join("circuits/build/verification_key.json");
    let zkey = root.join("circuits/build/shielded_transfer_final.zkey");
    println!("cargo:rerun-if-changed={}", vkey.display());
    if !vkey.exists() {
        panic!("missing {}. Run npm run circuit:setup", vkey.display());
    }
    let out = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    generate_vk_file(
        vkey.to_str().unwrap(),
        out.to_str().unwrap(),
        "verifying_key.rs",
        SetupKind::InsecureTest,
        ProvingKeySource::File(&zkey),
    )
    .expect("verifying key");
}
