#!/bin/sh
# Next.js inlines NEXT_PUBLIC_* variables at build time. The image is built with the placeholder
# __PROVISIA_PUBLIC_API_URL__ so one image works for every installation: on start the placeholder is
# replaced with NEXT_PUBLIC_API_URL (falls back to APP_URL, then to "" = same origin as the page).
set -eu

placeholder="__PROVISIA_PUBLIC_API_URL__"
value="${NEXT_PUBLIC_API_URL:-${APP_URL:-}}"
value="${value%/}"

if [ ! -f /app/.provisia-env-applied ] || [ "$(cat /app/.provisia-env-applied)" != "$value" ]; then
  echo "provisia-web: NEXT_PUBLIC_API_URL=${value:-<same origin>}"
  # Replace in every JS chunk (client bundles under .next/static, server bundles under apps/web/.next/server).
  find /app/apps/web/.next -type f \( -name '*.js' -o -name '*.json' -o -name '*.html' -o -name '*.rsc' \) \
    -exec grep -lF "$placeholder" {} + 2>/dev/null \
    | while IFS= read -r f; do
        # '|' cannot appear in a URL authority/path we care about; escape '&' and '\' for sed replacement.
        esc=$(printf '%s' "$value" | sed -e 's/[\\&|]/\\&/g')
        sed -i "s|$placeholder|$esc|g" "$f"
      done
  printf '%s' "$value" > /app/.provisia-env-applied
fi

# podman sets HOSTNAME to the container id; the Next.js standalone server would bind to it. Bind to all interfaces.
export HOSTNAME="${WEB_BIND_HOST:-0.0.0.0}"

exec "$@"
