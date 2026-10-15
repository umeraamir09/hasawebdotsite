"""Inspect or apply the explicitly approved, isolated S-3 routing experiment."""
import argparse
import datetime
import json
import os
from pathlib import Path
import tomllib
import urllib.error
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument("--account", required=True)
parser.add_argument("--zone", required=True)
parser.add_argument("--apply-approved-routes", action="store_true")
parser.add_argument("--attach-approved-assets", action="store_true")
parser.add_argument("--output", default=".wrangler/routing-production")
args = parser.parse_args()
output = Path(args.output)
output.mkdir(parents=True, exist_ok=True)
token = os.environ.get("CLOUDFLARE_API_TOKEN")
if not token:
    config = Path(os.environ.get("XDG_CONFIG_HOME", str(Path.home() / ".config"))) / ".wrangler/config/default.toml"
    token = tomllib.loads(config.read_text())["oauth_token"]

def call(path, body=None):
    request = urllib.request.Request("https://api.cloudflare.com/client/v4" + path, data=json.dumps(body).encode() if body is not None else None, headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
    try:
        response = urllib.request.urlopen(request, timeout=30)
    except urllib.error.HTTPError as error:
        response = error
    return {"httpStatus": response.status, "response": json.load(response)}

zone = call(f"/zones/{args.zone}")
assert zone["response"].get("result", {}).get("name") == "hasaweb.site", "Wrong zone"
routes = call(f"/zones/{args.zone}/workers/routes")
assert routes["response"].get("success"), "Cannot inspect existing routes"
plan = [
    {"pattern": "assets.hasaweb.site/*", "script": None, "request_limit_fail_open": False},
    {"pattern": "hasaweb.site/*", "script": "hasaweb-s2-spike", "request_limit_fail_open": False},
    {"pattern": "www.hasaweb.site/*", "script": "hasaweb-s3-redirect", "request_limit_fail_open": False},
    {"pattern": "*.hasaweb.site/*", "script": "hasaweb-s3-site", "request_limit_fail_open": False},
]
report = {"at": datetime.datetime.now(datetime.timezone.utc).isoformat(), "zone": {"name": "hasaweb.site", "status": zone["response"]["result"]["status"]}, "beforeRoutes": routes, "plan": plan, "applied": []}
if args.apply_approved_routes:
    existing = {route["pattern"]: route for route in routes["response"]["result"]}
    for route in plan:
        if route["pattern"] in existing:
            current = existing[route["pattern"]]
            assert current.get("script") == route["script"] and current.get("request_limit_fail_open") is False, "Conflicting route; do not overwrite"
            continue
        applied = call(f"/zones/{args.zone}/workers/routes", route)
        report["applied"].append(applied)
        if not applied["response"].get("success"):
            break
if args.attach_approved_assets:
    report["assetDomain"] = call(f"/accounts/{args.account}/r2/buckets/hasaweb-s3-assets/domains/custom", {"domain": "assets.hasaweb.site", "enabled": True, "zoneId": args.zone, "minTLS": "1.2"})
report["afterRoutes"] = call(f"/zones/{args.zone}/workers/routes")
report["assetDomainStatus"] = call(f"/accounts/{args.account}/r2/buckets/hasaweb-s3-assets/domains/custom")
report["sitesDomainStatus"] = call(f"/accounts/{args.account}/r2/buckets/hasaweb-s3-sites/domains/custom")
report["assetsManagedDomain"] = call(f"/accounts/{args.account}/r2/buckets/hasaweb-s3-assets/domains/managed")
report["sitesManagedDomain"] = call(f"/accounts/{args.account}/r2/buckets/hasaweb-s3-sites/domains/managed")
path = output / ("configuration-applied.json" if args.apply_approved_routes else "configuration-status.json")
path.write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps({"output": str(path), "zoneStatus": report["zone"]["status"], "routes": report["afterRoutes"]["response"].get("result"), "assetDomainStatus": report["assetDomainStatus"]}))
