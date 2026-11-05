#![no_main]

use libfuzzer_sys::fuzz_target;
use shade_crypto::parse_canonical_field;

fuzz_target!(|data: &[u8]| {
    if let Ok(text) = std::str::from_utf8(data) {
        let _ = parse_canonical_field(text);
    }
});
