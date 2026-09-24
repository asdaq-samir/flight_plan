#!/bin/sh
# A local certificate authority and a server certificate for the
# webapp's HTTPS port (see HttpsConnectorConfig), so a phone on the same
# Wi-Fi reaches the app over a secure origin -- the one the browser
# grants geolocation and a service worker to.
#
#   infra/local-https/make-certs.sh 192.168.1.42            # your Mac's LAN address
#   infra/local-https/make-certs.sh --new-ca 192.168.1.42   # replace the authority too
#
# Writes into infra/local-https/certs/ (ignored by git):
#   ca.pem       the authority's certificate -- install this on the phone
#   webapp.p12   the server certificate and key, PKCS12, for the webapp
#
# The authority's own key is kept out of the repo, in
# ~/.config/vfr-local-ca (VFR_LOCAL_CA_DIR to change it). The repo is
# mounted read-write into most of the compose services, and anything
# that can read that key can mint a certificate the phone trusts -- for
# any site, unless the authority is name-constrained. So a new
# authority is: it can only vouch for private addresses and localhost.
# An authority made before that has no constraint; --new-ca replaces
# it with one that does (then install the new ca.pem on the phone and
# remove the old profile).
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

new_ca=0
if [ "${1:-}" = "--new-ca" ]; then new_ca=1; shift; fi
address="${1:?the LAN address the phone will use, e.g. 192.168.1.42}"
here="$(cd "$(dirname "$0")" && pwd)"
out="$here/certs"
ca_dir="${VFR_LOCAL_CA_DIR:-$HOME/.config/vfr-local-ca}"
mkdir -p "$out" "$ca_dir"
chmod 700 "$ca_dir"
# The PKCS12 container's password, the one the webapp opens it with by
# default (app.https.keystore-password). It protects nothing -- the key
# sits unencrypted beside it in certs/ -- and it used to be a setting
# read here from the environment and by compose from .env: set in .env
# alone, it made a keystore the webapp could not open.
password=changeit

# An authority made by an earlier version of this script kept its key
# beside the certificates; move it out, once.
if [ -f "$out/ca.key" ] && [ ! -f "$ca_dir/ca.key" ]; then
  mv "$out/ca.key" "$ca_dir/ca.key"
  if [ -f "$out/ca.srl" ]; then mv "$out/ca.srl" "$ca_dir/ca.srl"; fi
  echo "moved the authority's key out of the repo, to $ca_dir"
fi
if [ "$new_ca" = 1 ] && [ -f "$ca_dir/ca.key" ]; then
  stamp="$(date +%Y%m%d%H%M%S)"
  mv "$ca_dir/ca.key" "$ca_dir/ca.key.replaced-$stamp"
  echo "set the old authority's key aside as $ca_dir/ca.key.replaced-$stamp"
fi

docker run --rm --entrypoint sh -v "$out:/certs" -v "$ca_dir:/ca" -w /certs \
  -e ADDRESS="$address" -e PASSWORD="$password" alpine/openssl -c '
  set -eu
  if [ ! -f /ca/ca.key ]; then
    openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
      -keyout /ca/ca.key -out /ca/ca.pem -subj "/CN=VFR Route local CA" \
      -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" \
      -addext "nameConstraints=critical,permitted;IP:10.0.0.0/255.0.0.0,permitted;IP:172.16.0.0/255.240.0.0,permitted;IP:192.168.0.0/255.255.0.0,permitted;IP:127.0.0.0/255.0.0.0,permitted;DNS:localhost"
  elif [ ! -f /ca/ca.pem ]; then
    cp ca.pem /ca/ca.pem   # an authority from before the key moved: its certificate is still here
  fi
  cp /ca/ca.pem ca.pem
  openssl req -newkey rsa:2048 -nodes -keyout webapp.key -out webapp.csr -subj "/CN=vfr-route local"
  printf "subjectAltName=IP:%s,IP:127.0.0.1,DNS:localhost\nextendedKeyUsage=serverAuth\n" "$ADDRESS" > san.cnf
  openssl x509 -req -in webapp.csr -CA /ca/ca.pem -CAkey /ca/ca.key -CAserial /ca/ca.srl -CAcreateserial \
    -days 365 -sha256 -extfile san.cnf -out webapp.pem
  openssl pkcs12 -export -inkey webapp.key -in webapp.pem -certfile ca.pem -name webapp \
    -passout "pass:$PASSWORD" -out webapp.p12
  rm -f webapp.csr san.cnf
  chmod 644 webapp.p12 ca.pem
  if ! openssl x509 -in ca.pem -noout -ext nameConstraints 2>/dev/null | grep -qi permitted; then
    echo "note: this authority has no name constraints -- run again with --new-ca to replace it" >&2
  fi
'
echo "wrote $out/ca.pem (install on the phone) and $out/webapp.p12 (the webapp reads it)"
echo "now: docker compose up -d webapp, then open https://$address:8443/app/plan on the phone"
