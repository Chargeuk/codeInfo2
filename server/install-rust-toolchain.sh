#!/bin/sh
# Image-build only. Unknown version/architecture combinations fail closed.
set -eu

install_method="${CODEINFO_WASM_INSTALL_METHOD:-release}"
case "$install_method" in
  release | source) ;;
  *) echo 'CODEINFO_WASM_INSTALL_METHOD must be release or source' >&2; exit 1 ;;
esac

case "$TARGETARCH" in
  amd64) release_arch=x86_64 ;;
  arm64) release_arch=aarch64 ;;
  *) echo "Unsupported Rust/WASM architecture: $TARGETARCH" >&2; exit 1 ;;
esac

download() {
  tool="$1" version="$2" url="$3" destination="$4"
  expected="$(awk -v t="$tool" -v v="$version" -v a="$TARGETARCH" \
    '$1 == t && $2 == v && $3 == a { print $4 }' /tmp/toolchain-checksums.txt)"
  [ "${#expected}" = 64 ] || {
    echo "No checksum for $tool $version $TARGETARCH" >&2; exit 1;
  }
  curl --fail --location --retry 3 --proto '=https' --tlsv1.2 "$url" -o "$destination"
  printf '%s  %s\n' "$expected" "$destination" | sha256sum -c -
}

temporary_dir="$(mktemp -d)"
trap 'rm -rf "$temporary_dir"' EXIT HUP INT TERM
download rustup "$RUSTUP_VERSION" \
  "https://static.rust-lang.org/rustup/archive/$RUSTUP_VERSION/$release_arch-unknown-linux-gnu/rustup-init" \
  "$temporary_dir/rustup-init"
chmod 755 "$temporary_dir/rustup-init"
"$temporary_dir/rustup-init" -y --no-modify-path --profile minimal \
  --default-toolchain "$RUST_VERSION" --target wasm32-unknown-unknown \
  --component rustfmt --component clippy

if [ "$install_method" = source ]; then
  # Cargo verifies registry checksums and uses the mirror configured in CARGO_HOME.
  apt-get update
  apt-get install -y --no-install-recommends cmake
  rm -rf /var/lib/apt/lists/*
  export CARGO_TARGET_DIR=/var/cache/codeinfo-cargo-target
  cargo install --locked --jobs 4 --root /opt/wasm-tools \
    --version "$WASM_PACK_VERSION" wasm-pack
  cargo install --locked --jobs 4 --root /opt/wasm-tools \
    --version "$WASM_BINDGEN_VERSION" wasm-bindgen-cli

  # Pin the source revision as well as the version; never follow a moving branch.
  git init "$temporary_dir/binaryen"
  git -C "$temporary_dir/binaryen" remote add origin https://github.com/WebAssembly/binaryen.git
  git -C "$temporary_dir/binaryen" fetch --depth=1 origin "refs/tags/version_$BINARYEN_VERSION"
  git -C "$temporary_dir/binaryen" checkout --detach FETCH_HEAD
  test "$(git -C "$temporary_dir/binaryen" rev-parse HEAD)" = "$BINARYEN_SOURCE_COMMIT"
  cmake -S "$temporary_dir/binaryen" -B "$temporary_dir/binaryen-build" \
    -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTS=OFF -DBUILD_SHARED_LIBS=OFF \
    -DENABLE_WERROR=OFF \
    -DCMAKE_INSTALL_PREFIX=/opt/binaryen
  cmake --build "$temporary_dir/binaryen-build" --parallel 4
  cmake --install "$temporary_dir/binaryen-build"
else
  for tool in wasm-pack wasm-bindgen binaryen; do
    case "$tool" in
      wasm-pack)
        version="$WASM_PACK_VERSION"
        archive="wasm-pack-v$version-$release_arch-unknown-linux-musl"
        url="https://github.com/wasm-bindgen/wasm-pack/releases/download/v$version/$archive.tar.gz"
        ;;
      wasm-bindgen)
        version="$WASM_BINDGEN_VERSION"
        archive="wasm-bindgen-$version-$release_arch-unknown-linux-musl"
        url="https://github.com/wasm-bindgen/wasm-bindgen/releases/download/$version/$archive.tar.gz"
        ;;
      binaryen)
        version="$BINARYEN_VERSION"
        archive="binaryen-version_$version"
        url="https://github.com/WebAssembly/binaryen/releases/download/version_$version/$archive-$release_arch-linux.tar.gz"
        ;;
    esac
    download "$tool" "$version" "$url" "$temporary_dir/$tool.tar.gz"
    tar -xzf "$temporary_dir/$tool.tar.gz" -C "$temporary_dir"
    if [ "$tool" = binaryen ]; then
      mkdir -p /opt/binaryen
      cp -a "$temporary_dir/$archive/." /opt/binaryen/
    else
      mkdir -p /opt/wasm-tools/bin
      install -m 755 "$temporary_dir/$archive/$tool" "/opt/wasm-tools/bin/$tool"
    fi
  done
fi

rustup --version
rustc --version
cargo --version
rustfmt --version
cargo clippy --version
wasm-pack --version
wasm-bindgen --version
wasm-opt --version
