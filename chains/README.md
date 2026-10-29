# Chain adapters

This directory is reserved for chain-specific implementations of the Shade Protocol. The current scaffold is intentionally abstract, but the final architecture should follow the optimized model below:

- `solana/` — program adapters, wallet integration, serialization, and settlement wrappers
- `near/` — NEAR contract wrappers and state sync
- `canton/` — DAML templates and institutional workflow layers
- `robinhood/` — broker API adapter and order-routing integration

The important optimization is that these adapters remain thin. They should not own the core privacy logic; they translate protocol state into chain-native execution and settlement calls.
