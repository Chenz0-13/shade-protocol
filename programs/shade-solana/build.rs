use groth16_solana::vk::circom::generate_vk_file;
use groth16_solana::vk::setup::{ProvingKeySource, SetupKind};
use std::path::Path;

fn main() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let vkey = root.join("circuits/build/verification_key.json");
    let zkey = root.join("circuits/build/shielded_transfer_final.zkey");
    println!("cargo:rerun-if-changed={}", vkey.display());
    if !vkey.exists() {
        // Clippy in the security workflow does not run the devnet setup.
        // A zero key lets the crate typecheck. It is not a verifier. The main
        // CI job still panics here unless `npm run circuit:setup` has run.
        if std::env::var("SHADE_CLIPPY_STUB_VKEY").ok().as_deref() == Some("1") {
            write_stub_vkey();
            return;
        }
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

/// Zero Groth16 key used only so `cargo clippy` can typecheck without a setup.
/// Proof checks against this key are meaningless. Do not deploy it.
fn write_stub_vkey() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/verifying_key.rs");
    let g1 = "[0u8; 64]";
    let g2 = "[0u8; 128]";
    let body = format!(
        r#"// Generated only when SHADE_CLIPPY_STUB_VKEY=1. Not a real verifying key.
use groth16_solana::groth16::Groth16Verifyingkey;

#[rustfmt::skip]
pub const VERIFYINGKEY: Groth16Verifyingkey = Groth16Verifyingkey {{
    nr_pubinputs: 7,
    vk_alpha_g1: {g1},
    vk_beta_g2: {g2},
    vk_gamma_g2: {g2},
    vk_delta_g2: {g2},
    vk_ic: &[{g1}, {g1}, {g1}, {g1}, {g1}, {g1}, {g1}, {g1}],
    vk_commitment: None,
}};

#[allow(dead_code)]
pub const VERIFYINGKEY_PROVING_KEY_SHA256: [u8; 32] = [0u8; 32];

#[allow(dead_code)]
pub const VERIFYINGKEY_INSECURE_TEST_SETUP: bool = true;

#[unsafe(export_name = "groth16_solana_vk_setup_clippy_stub")]
pub static VERIFYINGKEY_SETUP_TXT: &str = "clippy stub, not a verifying key";

#[cfg(not(feature = "insecure-test-setup"))]
compile_error!("stub verifying key");
"#
    );
    std::fs::write(path, body).expect("stub verifying key");
}
