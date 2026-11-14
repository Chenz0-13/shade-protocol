#![no_main]

use libfuzzer_sys::fuzz_target;
use shade_crypto::screen_proof_json;

fuzz_target!(|data: &[u8]| {
    let _ = screen_proof_json(data);
});
