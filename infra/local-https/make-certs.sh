#!/bin/sh
# A local certificate authority and a server certificate for the
# webapp's HTTPS port (see HttpsConnectorConfig), so a phone on the same
# Wi-Fi reaches the app over a secure origin -- the one the browser
# grants geolocation and a service worker to.
#
#   infra/local-https/make-certs.sh 192.168.1.42    # your Mac's LAN address
#
# Writes into infra/local-https/certs/ (ignored by git):
#   ca.pem       the authority's certificate -- install this on the phone
#   webapp.p12   the server certificate and key, PKCS12, for the webapp
#
# Runs openssl in a container so nothing has to be installed here.
# Then `docker compose up -d webapp`, and on the phone open
# https://<address>:8443/app/plan after trusting ca.pem:
#   iPhone: AirDrop or mail ca.pem to it, Settings > General > VPN &
#           Device Management > install the profile, then Settings >
#           General > About > Certificate Trust Settings > turn it on.
#   Android: Settings > Security > Encryption & credentials > Install
#           a certificate > CA certificate.
# The server certificate lasts a year; run this again to renew it.
set -eu

address="${1:?the LAN address the phone will use, e.g. 192.168.1.42}"
here="$(cd "$(dirname "$0")" && pwd)"
out="$here/certs"
mkdir -p "$out"
password="${WEBAPP_KEYSTORE_PASSWORD:-changeit}"

docker run --rm --entrypoint sh -v "$out:/certs" -w /certs -e ADDRESS="$address" -e PASSWORD="$password" alpine/openssl -c '
  set -eu
  if [ ! -f ca.key ]; then
    openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
      -keyout ca.key -out ca.pem -subj "/CN=VFR Route local CA" \
      -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign"
  fi
  openssl req -newkey rsa:2048 -nodes -keyout webapp.key -out webapp.csr -subj "/CN=vfr-route local"
  printf "subjectAltName=IP:%s,IP:127.0.0.1,DNS:localhost\nextendedKeyUsage=serverAuth\n" "$ADDRESS" > san.cnf
  openssl x509 -req -in webapp.csr -CA ca.pem -CAkey ca.key -CAcreateserial -days 365 -sha256 \
    -extfile san.cnf -out webapp.pem
  openssl pkcs12 -export -inkey webapp.key -in webapp.pem -certfile ca.pem -name webapp \
    -passout "pass:$PASSWORD" -out webapp.p12
  rm -f webapp.csr san.cnf
  chmod 644 webapp.p12 ca.pem
'
echo "wrote $out/ca.pem (install on the phone) and $out/webapp.p12 (the webapp reads it)"
echo "now: docker compose up -d webapp, then open https://$address:8443/app/plan on the phone"
