#!/bin/sh
# Set a new password for a staff login (dispatch or captain), for when someone
# is locked out and the reset email can't help.
#
# Run it yourself, in your own terminal: it asks for the password with typing
# hidden, and sends it straight to Supabase. It is never printed, saved, or
# passed on the command line.
#
#   sh scripts/set-staff-password.sh
#
# Needs the Supabase CLI, logged in and linked to this project (it is, on Jack's Mac).

set -eu
cd "$(dirname "$0")/.."
REF="fjdoaonnoezbbitbawzs"
URL="https://$REF.supabase.co"
export TMPDIR="$HOME/.cache/supabase-tmp/"

printf "Email of the login to reset: "
read -r EMAIL

stty -echo 2>/dev/null || true
printf "New password (typing is hidden): "
read -r PW1; echo
printf "Same again: "
read -r PW2; echo
stty echo 2>/dev/null || true

[ "$PW1" = "$PW2" ] || { echo "Those didn't match — nothing was changed."; exit 1; }
[ ${#PW1} -ge 8 ] || { echo "Use at least 8 characters — nothing was changed."; exit 1; }

# The service key never leaves this script's memory.
KEY=$(supabase projects api-keys --project-ref "$REF" -o json </dev/null 2>/dev/null |
  python3 -c "import json,sys; print([k['api_key'] for k in json.load(sys.stdin) if k.get('name')=='service_role'][0])")

EMAIL="$EMAIL" PW="$PW1" KEY="$KEY" URL="$URL" python3 - <<'PY'
import json, os, urllib.request

url, key = os.environ["URL"], os.environ["KEY"]
email = os.environ["EMAIL"].strip().lower()
headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}

def call(method, path, body=None):
    req = urllib.request.Request(url + path, method=method, headers=headers,
                                 data=json.dumps(body).encode() if body is not None else None)
    with urllib.request.urlopen(req) as r:
        return json.load(r)

user, page = None, 1
while user is None:
    users = call("GET", f"/auth/v1/admin/users?page={page}&per_page=200").get("users", [])
    if not users:
        break
    user = next((u for u in users if (u.get("email") or "").lower() == email), None)
    page += 1

if user is None:
    raise SystemExit(f"No login found for {email} — nothing was changed.")

call("PUT", f"/auth/v1/admin/users/{user['id']}", {"password": os.environ["PW"]})
print(f"Done. {email} can sign in with the new password now.")
PY
