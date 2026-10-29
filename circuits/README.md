# ZK circuits

This directory contains the proof layer for the protocol. The final architecture should keep proof generation / verification abstracted behind a protocol trait so the same logic can work with multiple proving backends.

Recommended circuit groups:

- shielded transfer proofs
- nullifier derivation proofs
- membership proofs for Merkle commitments
- settlement / pool invariant proofs
- KYC / compliance proofs
- governance and policy proofs

The current files are scaffolds only and should be replaced with validated proving artifacts in production.
