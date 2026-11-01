#!/usr/bin/env bash
# Creates a self-signed HTTPS certificate so the iPad can use the microphone
# when it opens this server over your Wi-Fi (https://<PC IP>:3443).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p certs

SAN="DNS:localhost,IP:127.0.0.1"
for ip in $(node -e 'for (const l of Object.values(require("os").networkInterfaces()).flat()) if (l.family==="IPv4" && !l.internal) console.log(l.address)'); do
  SAN="$SAN,IP:$ip"
done

openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 825 \
  -keyout certs/key.pem -out certs/cert.pem \
  -subj "/CN=Live Translator" -addext "subjectAltName=$SAN" 2>/dev/null

echo "✅ certs/cert.pem 생성 완료 ($SAN)"
echo "   서버를 다시 시작하면 https 주소가 표시됩니다."
