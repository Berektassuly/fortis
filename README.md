# Fortis Anchor Workspace

This repository is an Anchor workspace with one on-chain program at `programs/rwa_tokenizer`.

## Why `anchor build` currently fails

The repo structure is valid enough for Anchor to discover the program, but the machine still needs the Solana SBF build toolchain that Anchor shells out to during builds.

On this Windows environment, these commands are currently missing:

- `solana`
- `cargo build-sbf`

When those are missing, `anchor build` and `anchor test` fail with a generic `program not found` error.

## Repo fixes already applied

- Aligned the Anchor workspace to use `npm`
- Switched the test runner in `Anchor.toml` from `yarn` to `npm exec -- ts-mocha`
- Normalized workspace members to `programs/*`
- Moved Rust dependency versions to workspace-level dependencies
- Set the program crate to Rust 2021 edition, which is the safer target for current Anchor/SBF toolchains
- Removed the stale `pnpm-lock.yaml` so `package-lock.json` is the single JS dependency source of truth

## What you need on your machine

For Solana program development, use WSL2 or a Linux/macOS environment, then install:

1. AVM / Anchor CLI `0.32.1`
2. Solana/Agave CLI with SBF tooling available
3. Node dependencies with `npm install`

If this repo was previously installed with pnpm, delete `node_modules` once and then reinstall with npm so the JavaScript Anchor client matches `package-lock.json`.

## Expected verification commands

After the toolchain is installed in a supported environment:

```bash
anchor build
anchor test
```
