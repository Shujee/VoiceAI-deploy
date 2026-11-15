#!/usr/bin/env bash
set -euo pipefail

# Renders infra/livekit/livekit.yaml and infra/kamailio/kamailio.cfg from
# their .template counterparts, substituting SIP_LAN_IP (read from the
# top-level .env) for every __SIP_LAN_IP__ placeholder.
#
# Why this exists: those two files bake this machine's externally-
# reachable IP directly into static config that LiveKit/Kamailio read
# from disk - docker-compose only substitutes ${VARS} inside
# docker-compose.yml itself, not inside files it mounts as volumes, so
# there was no way for either of them to pick up SIP_LAN_IP automatically.
# Before this script, switching between a LAN test rig and a GCP VM meant
# hand-editing the IP in (at least) four places: top-level .env,
# ai-runtime/.env, this file's node_ip, and kamailio.cfg's advertise line
# - and they could silently drift out of sync (confirmed bug, commit
# 4deae5b). Now there's exactly one: SIP_LAN_IP in the top-level .env.
# ai-runtime no longer needs its own copy either - docker-compose.yml
# injects SIP_LAN_IP into the ai-runtime container's environment straight
# from this same top-level .env (see its `environment:` block).
#
# bash, not PowerShell - this project is deployed on a Linux GCP VM and
# developed locally with bash throughout; one script that runs unchanged
# in both places beats maintaining a .ps1/.sh pair that can drift apart.
#
# Run this from the repo root any time SIP_LAN_IP changes, then restart
# the containers that read the generated files:
#   bash infra/render-config.sh
#   docker compose up -d --force-recreate livekit sip sip-registrar ai-runtime
# (the `sip` service reads SIP_LAN_IP straight from docker-compose.yml's
# own ${SIP_LAN_IP} substitution, not from a generated file, so it just
# needs `docker compose up -d --force-recreate sip` too if it's already
# running - not a render.)

if [ ! -f .env ]; then
  echo "Error: .env not found in the current directory - run this from the repo root." >&2
  exit 1
fi

sip_lan_ip=$(grep '^SIP_LAN_IP=' .env | tail -n1 | cut -d'=' -f2- | xargs)

if [ -z "$sip_lan_ip" ]; then
  echo "Error: SIP_LAN_IP is not set (or empty) in .env - set it to this machine's externally-reachable IP." >&2
  exit 1
fi

render() {
  local template="$1"
  local output="$2"

  if [ ! -f "$template" ]; then
    echo "Error: template not found: $template" >&2
    exit 1
  fi

  sed "s/__SIP_LAN_IP__/$sip_lan_ip/g" "$template" > "$output"
  echo "Rendered $output"
}

echo "Rendering config from SIP_LAN_IP=$sip_lan_ip ..."

render infra/livekit/livekit.yaml.template infra/livekit/livekit.yaml
render infra/kamailio/kamailio.cfg.template infra/kamailio/kamailio.cfg

echo ""
echo "Done. Restart the affected containers to pick this up:"
echo "  docker compose up -d --force-recreate livekit sip sip-registrar"
