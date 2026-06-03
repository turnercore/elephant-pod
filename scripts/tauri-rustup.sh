#!/bin/sh
set -eu

# Tauri's Xcode build phase inherits the environment from this shell.
# Pin the stable rustup toolchain so iOS/macOS builds use the same rustc/cargo.
export RUSTUP_TOOLCHAIN=stable-aarch64-apple-darwin
export RUSTC="$(rustup which rustc)"
export CARGO="$(rustup which cargo)"

exec tauri "$@"
