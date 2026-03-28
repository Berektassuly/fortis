//! Fortis RWA backend.
//!
//! This crate receives signed Token-2022 transfer requests, performs wallet
//! screening, queues Fortis `approve_wallet` submissions, and relays the
//! public transfer once the approval is confirmed.

pub mod api;
pub mod app;
pub mod domain;
pub mod infra;

#[cfg(any(test, feature = "test-utils"))]
pub mod test_utils;
