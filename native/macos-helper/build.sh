#!/bin/sh
# Builds the macOS display helper. Requires Xcode Command Line Tools (swiftc).
set -eu
cd "$(dirname "$0")"
mkdir -p build
swiftc -O main.swift -o build/phosphor-helper
echo "built $(pwd)/build/phosphor-helper"
