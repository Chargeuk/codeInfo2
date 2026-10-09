#!/bin/sh
# Image-build only. Unknown version/architecture combinations fail closed.
set -eu

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

rustup --version
rustc --version
cargo --version
rustfmt --version
cargo clippy --version
wasm-pack --version
wasm-bindgen --version
wasm-opt --version
