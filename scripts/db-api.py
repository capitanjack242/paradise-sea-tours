#!/usr/bin/env python3
"""Migrations through Supabase's web API, for machines that can't reach the
database directly (the Claude cloud sessions only allow HTTPS, so
`supabase link`, `migration list` and `db push` hang there).

    python3 scripts/db-api.py list          # local vs live, like `supabase migration list`
    python3 scripts/db-api.py push          # shows what would be applied, changes nothing
    python3 scripts/db-api.py push --yes    # applies them, oldest first, each in one transaction

Needs SUPABASE_ACCESS_TOKEN (a full-access token from Account > Access Tokens).
Each migration is applied together with its row in
supabase_migrations.schema_migrations, so the CLI on the Mac sees the same
history afterwards. Edge Functions don't need this: they deploy over HTTPS with
`npx supabase functions deploy <name> --project-ref fjdoaonnoezbbitbawzs --use-api`.
"""
import json
import os
import pathlib
import secrets
import sys
import urllib.error
import urllib.request

REF = "fjdoaonnoezbbitbawzs"
API = f"https://api.supabase.com/v1/projects/{REF}"
MIGRATIONS = pathlib.Path(__file__).resolve().parent.parent / "supabase" / "migrations"


def call(method, path, body=None):
    token = os.environ.get("SUPABASE_ACCESS_TOKEN")
    if not token:
        sys.exit("SUPABASE_ACCESS_TOKEN is not set — nothing was done.")
    req = urllib.request.Request(
        API + path,
        method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json",
                 "User-Agent": "paradise-db-api"},
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read() or "null")
    except urllib.error.HTTPError as e:
        sys.exit(f"Supabase said {e.code}: {e.read().decode()[:500]}")


def local():
    out = {}
    for f in sorted(MIGRATIONS.glob("*.sql")):
        version, _, name = f.stem.partition("_")
        out[version] = (name, f)
    return out


def remote():
    return {m["version"]: m.get("name", "") for m in call("GET", "/database/migrations")}


def cmd_list():
    loc, rem = local(), remote()
    print(f"{'Local':<8}{'Live':<8}Name")
    for v in sorted(set(loc) | set(rem)):
        name = loc[v][0] if v in loc else rem[v]
        print(f"{v if v in loc else '':<8}{v if v in rem else '':<8}{name}")
    pending = [v for v in loc if v not in rem]
    extra = [v for v in rem if v not in loc]
    print(f"\n{len(loc)} local, {len(rem)} live, {len(pending)} not applied yet"
          + (f", {len(extra)} live but missing here: {', '.join(extra)}" if extra else ""))


def quote(text):
    tag = "m" + secrets.token_hex(6)
    return f"${tag}${text}${tag}$"


def cmd_push(apply):
    loc, rem = local(), remote()
    pending = [v for v in sorted(loc) if v not in rem]
    if not pending:
        print("Live database is up to date — nothing to apply.")
        return
    newest_live = max(rem) if rem else ""
    for v in pending:
        if v < newest_live:
            sys.exit(f"{v} is older than the newest live migration ({newest_live}) — "
                     "renumber it before pushing. Nothing was applied.")
    print("To apply:", ", ".join(f"{v}_{loc[v][0]}" for v in pending))
    if not apply:
        print("Nothing applied. Run again with --yes to apply.")
        return
    for v in pending:
        name, path = loc[v]
        sql = path.read_text()
        query = (f"begin;\n{sql}\n;\n"
                 "insert into supabase_migrations.schema_migrations (version, name, statements) "
                 f"values ({quote(v)}, {quote(name)}, array[{quote(sql)}]);\ncommit;")
        call("POST", "/database/query", {"query": query})
        print(f"applied {v}_{name}")
    print("Done. Check with: python3 scripts/db-api.py list")


if __name__ == "__main__":
    args = sys.argv[1:]
    if args[:1] == ["list"]:
        cmd_list()
    elif args[:1] == ["push"]:
        cmd_push("--yes" in args)
    else:
        print(__doc__)
        sys.exit(1)
