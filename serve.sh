#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
PORT="${PORT:-8080}"
cd "$ROOT"

LAN_IP=""
if [[ "$(uname -s)" == "Darwin" ]]; then
  for iface in en0 en1 en2 en3; do
    ip="$(ipconfig getifaddr "$iface" 2>/dev/null || true)"
    if [[ -n "${ip}" ]]; then
      LAN_IP="${ip}"
      break
    fi
  done
fi
if [[ -z "${LAN_IP}" ]]; then
  echo "Could not detect LAN IP. Serving on 127.0.0.1 only."
  LAN_IP="127.0.0.1"
fi

if [[ -f cert.pem && -f key.pem ]]; then
  echo "pwarx — local HTTPS server"
  echo "On this Mac : https://localhost:${PORT}/"
  echo "On LAN      : https://${LAN_IP}:${PORT}/"
  exec python3 -c "
import http.server, ssl, os
os.chdir('$ROOT')
ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain('cert.pem', 'key.pem')
httpd = http.server.HTTPServer(('0.0.0.0', $PORT), http.server.SimpleHTTPRequestHandler)
httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
print('Serving HTTPS on port $PORT')
httpd.serve_forever()
"
else
  echo "pwarx — local HTTP server (no cert found; SW works only on localhost)"
  echo "On this Mac : http://127.0.0.1:${PORT}/"
  echo "On LAN      : http://${LAN_IP}:${PORT}/"
  echo
  echo "To enable HTTPS, place cert.pem + key.pem in this directory,"
  echo "or run: mkcert -install && mkcert -key-file key.pem -cert-file cert.pem localhost 127.0.0.1"
  echo
  exec python3 -m http.server "$PORT" --bind 0.0.0.0
fi