# Docker SSL Certificate Setup

These instructions use **Windows PowerShell for export** and **WSL for the remaining steps**. The Docker example uses Ubuntu; Debian-based images use the same certificate commands.

## 1. Export the certificate from Windows

**What:** Export the company certificate already trusted by Windows.

**Why:** WSL and Docker need their own copies to trust connections inspected by Marex.

Run in **Windows PowerShell**:

```powershell
$certificateName = "Marex Spectron CA for Trusted sites"

$certificates = @(Get-ChildItem Cert:\LocalMachine\Root |
    Where-Object {
        $_.GetNameInfo("SimpleName", $false) -eq $certificateName
    })

if ($certificates.Count -ne 1) {
    throw "Expected exactly one matching certificate. Check the certificate name."
}

New-Item -ItemType Directory -Path C:\temp\cert -Force | Out-Null

Export-Certificate -Cert $certificates[0] `
    -FilePath C:\temp\cert\company-root.cer -Force
```

This exports the public certificate without its private key. [Microsoft documentation](https://learn.microsoft.com/en-us/powershell/module/pki/export-certificate)

## 2. Import the certificate into WSL

**What:** Convert the exported certificate and install it into WSL's trusted certificate store.

**Why:** Windows and WSL have separate certificate stores.

Run in **WSL**:

```bash
mkdir -p "$HOME/corp-certs"

openssl x509 -inform DER \
  -in /mnt/c/temp/cert/company-root.cer \
  -out "$HOME/corp-certs/company-root.crt"

sudo install -m 0644 "$HOME/corp-certs/company-root.crt" \
  /usr/local/share/ca-certificates/company-root.crt

sudo update-ca-certificates
```

Check HTTPS access:

```bash
/usr/bin/curl --fail --head https://github.com
```

**Expected:** HTTP headers without a certificate error.

## 3. Add the certificate to Docker images for building and running

**What:** Install the certificate into the image before HTTPS requests.

**Why:** Build commands can then trust Marex's connections, and new containers inherit that trust from the finished image. No runtime mount is required.

Run this minimal Ubuntu example in **WSL**:

```bash
docker build --no-cache \
  --tag company-trusted:local \
  --file - "$HOME/corp-certs" <<'DOCKERFILE'
FROM ubuntu:24.04

RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

COPY company-root.crt \
    /usr/local/share/ca-certificates/company-root.crt

RUN update-ca-certificates

# Check HTTPS access during the build.
RUN curl --fail --head https://github.com

# Check HTTPS access when a container starts.
CMD ["curl", "--fail", "--head", "https://github.com"]
DOCKERFILE
```

Check the finished image by starting a new container:

```bash
docker run --rm company-trusted:local
```

**Expected:** Both the build and container checks return HTTP headers without certificate errors.

For your application images, use the same certificate-install steps in their Dockerfiles:

- Install the certificate **before HTTPS downloads** in each independent build stage.
- Install it in the **final image** so running containers also trust it.
- Start containers from that final image normally.

The example above demonstrates the setup; it does not modify your existing application images. Applications with their own certificate stores may need additional configuration. [Docker certificate guidance](https://docs.docker.com/engine/network/ca-certs/)
