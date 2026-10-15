"""Read Cloudflare Worker analytics without printing or saving credentials."""
import argparse
import datetime
import json
import os
from pathlib import Path
import tomllib
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument("--account", required=True)
parser.add_argument("--worker", required=True)
parser.add_argument("--requests")
parser.add_argument("--windows")
parser.add_argument("--colo")
parser.add_argument("--from", dest="start")
parser.add_argument("--to", dest="end")
parser.add_argument("--output", required=True)
args = parser.parse_args()
token = os.environ.get("CLOUDFLARE_API_TOKEN")
if not token:
    config = Path(os.environ.get("XDG_CONFIG_HOME", str(Path.home() / ".config"))) / ".wrangler/config/default.toml"
    token = tomllib.loads(config.read_text())["oauth_token"]

def iso(ms):
    return datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")

windows = []
if args.requests:
    data = json.loads(Path(args.requests).read_text())
    for case in dict.fromkeys(sample["case"] for sample in data["samples"]):
        if case.startswith("warmup-") or case in ("first-candidate", "check"):
            continue
        samples = [sample for sample in data["samples"] if sample["case"] == case]
        windows.append({"case": case, "from": iso(samples[0]["at"]), "to": iso(samples[-1]["at"] + samples[-1]["elapsedMs"]), "clientCount": len(samples)})
elif args.windows:
    windows = [{"case": window["name"], **window} for window in json.loads(Path(args.windows).read_text())["windows"]]
else:
    assert args.start and args.end, "Supply --requests, --windows or --from and --to"
    windows.append({"case": "window", "from": args.start, "to": args.end})
fields = []
for index, window in enumerate(windows):
    filters = "scriptName:" + json.dumps(args.worker) + ",datetime_geq:" + json.dumps(window["from"]) + ",datetime_lt:" + json.dumps(window["to"])
    if args.colo:
        filters += ",coloCode:" + json.dumps(args.colo)
    fields.append(f"c{index}:workersInvocationsAdaptive(limit:100,filter:{{{filters}}}) {{ dimensions {{status coloCode}} avg {{sampleInterval}} sum {{requests errors cpuTimeUs}} quantiles {{cpuTimeP50 cpuTimeP95 cpuTimeP99}} }}")
query = "query {viewer {accounts(filter:{accountTag:" + json.dumps(args.account) + "}) {" + " ".join(fields) + "}}}"
request = urllib.request.Request("https://api.cloudflare.com/client/v4/graphql", data=json.dumps({"query": query}).encode(), headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
result = json.load(urllib.request.urlopen(request, timeout=30))
report = {"recordedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(), "windows": windows, "query": query, "result": result, "units": "cpuTimePXX and cpuTimeUs are microseconds. Divide by 1000 for milliseconds. Adaptive analytics and client-time window boundaries can change counts; this is not an unsampled request trace."}
Path(args.output).write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps({"output": args.output, "errors": result.get("errors")}))
