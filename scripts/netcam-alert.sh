#!/bin/sh
# Last-resort alert, run by systemd when a NetCam unit fails for good
# (OnFailure=). Talks to the WhatsApp hub directly, so it works even when
# the API and the network-agent are both down.
# Usage: netcam-alert.sh <unit-name>
set -eu
ENV_FILE="$(dirname "$0")/../apps/network-agent/.env"
[ -r "$ENV_FILE" ] || exit 0
get() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -n1; }
HUB_URL=$(get WHATSAPP_HUB_URL | sed 's#/*$##')
HUB_KEY=$(get WHATSAPP_HUB_API_KEY)
TEMPLATE=$(get WHATSAPP_HUB_TEMPLATE); TEMPLATE=${TEMPLATE:-general_app_update}
PHONES=$(get ALERT_FALLBACK_PHONES)
[ -n "$HUB_URL" ] && [ -n "$HUB_KEY" ] && [ -n "$PHONES" ] || exit 0
UNIT=$(printf '%s' "${1:-a NetCam service}" | tr -cd 'A-Za-z0-9@._-')
MSG="$UNIT on the gateway has stopped and could not restart itself. Customers may be unable to log in. Restart the gateway machine."
for PHONE in $(printf '%s' "$PHONES" | tr ',' ' '); do
  case "$PHONE" in 256[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]) ;; *) continue ;; esac
  curl -s -m 15 -o /dev/null -X POST "$HUB_URL/v1/integrations/templates/send" \
    -H "X-API-Key: $HUB_KEY" -H "Content-Type: application/json" \
    -d "{\"phoneNumber\":\"$PHONE\",\"templateName\":\"$TEMPLATE\",\"languageCode\":\"en_US\",\"variables\":{\"body\":[\"Admin\",\"NetCam WiFi\",\"URGENT: service down\",\"$MSG\"]}}" || true
done
