#!/usr/bin/env sh
set -eu

cert_dir="$1"
browser_home="$2"
runtime_uid="$3"
runtime_gid="$4"

if ! command -v certutil >/dev/null 2>&1; then
  echo "CODEINFO Chromium trust failed: certutil is missing (install libnss3-tools)" >&2
  exit 1
fi

# Chromium 146+ uses this location unless a legacy shared database exists.
nss_dir="${browser_home}/.local/share/pki/nssdb"
if [ -d "${browser_home}/.pki/nssdb" ]; then
  nss_dir="${browser_home}/.pki/nssdb"
fi
mkdir -p "$nss_dir"
if [ ! -f "${nss_dir}/cert9.db" ]; then
  certutil -N -d "sql:${nss_dir}" --empty-password
fi

imported_count=0
for cert_file in "$cert_dir"/*.crt; do
  [ -f "$cert_file" ] || continue
  # Fingerprints provide stable nicknames across repeated starts and duplicate files.
  fingerprint="$(openssl x509 -in "$cert_file" -noout -fingerprint -sha1 | sed 's/^[^=]*=//; s/://g')"
  case "$fingerprint" in
    '' | *[!0-9A-F]*)
      echo "CODEINFO Chromium trust failed: invalid certificate ${cert_file}" >&2
      exit 1
      ;;
  esac
  if [ "${#fingerprint}" -ne 40 ]; then
    echo "CODEINFO Chromium trust failed: invalid certificate fingerprint ${cert_file}" >&2
    exit 1
  fi
  certutil -A -d "sql:${nss_dir}" -n "codeinfo-root-${fingerprint}" -t "C,," -i "$cert_file"
  imported_count=$((imported_count + 1))
done
if [ "$imported_count" -eq 0 ]; then
  echo "CODEINFO Chromium trust failed: no .crt files found in ${cert_dir}" >&2
  exit 1
fi

# The entrypoint starts as root; retain access for the configured application user.
if [ "$(id -u)" = "0" ]; then
  chown -R "${runtime_uid}:${runtime_gid}" "$nss_dir"
fi
printf '[CODEINFO][CHROMIUM_CA_IMPORT] result=success crt_count=%s nss_dir=%s\n' "$imported_count" "$nss_dir"
