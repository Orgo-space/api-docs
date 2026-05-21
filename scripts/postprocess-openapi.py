#!/usr/bin/env python3
"""
Post-process a Symfony/API Platform OpenAPI export to be accepted by
Mintlify's validator.

Transformations (matching the manual pattern from the previous published file):
  1. links: [] -> links: {} (everywhere — OpenAPI requires a map, not array)
  2. Strip `content` block from 4xx/5xx response entries, keep only `description`
  3. Drop Error / Error.jsonld / ConstraintViolation / ConstraintViolation.jsonld
     schemas from components (their conditional schemas trip the validator)

Writes back minified JSON in place.
"""
import json
import sys
from pathlib import Path

if len(sys.argv) != 2:
    sys.exit("usage: postprocess_openapi.py PATH_TO_OPENAPI_JSON")

path = Path(sys.argv[1])
spec = json.loads(path.read_text())

links_fixed = 0
contents_stripped = 0

def fix_links(node):
    """Recursively convert any 'links': [] to {}."""
    global links_fixed
    if isinstance(node, dict):
        for k, v in list(node.items()):
            if k == "links" and isinstance(v, list) and not v:
                node[k] = {}
                links_fixed += 1
            else:
                fix_links(v)
    elif isinstance(node, list):
        for item in node:
            fix_links(item)

fix_links(spec)

# Top-level webhooks must also be an object (map), not array
if spec.get("webhooks") == []:
    spec["webhooks"] = {}

# Fixed object-typed slots that API Platform may emit as []
components = spec.get("components") or {}
for slot in ("responses", "parameters", "examples", "requestBodies",
             "headers", "securitySchemes", "callbacks", "links"):
    if components.get(slot) == []:
        components[slot] = {}

for path_url, methods in (spec.get("paths") or {}).items():
    if not isinstance(methods, dict):
        continue
    for method, op in methods.items():
        if not isinstance(op, dict):
            continue
        responses = op.get("responses") or {}
        for code, body in responses.items():
            if not isinstance(body, dict):
                continue
            try:
                code_int = int(code)
            except (TypeError, ValueError):
                continue
            if 400 <= code_int < 600 and "content" in body:
                del body["content"]
                contents_stripped += 1

schemas = spec.get("components", {}).get("schemas", {})
schemas_dropped = []
for name in ("Error", "Error.jsonld", "ConstraintViolation", "ConstraintViolation.jsonld"):
    if name in schemas:
        del schemas[name]
        schemas_dropped.append(name)

path.write_text(json.dumps(spec, ensure_ascii=False, separators=(",", ":")))

print(f"links [] -> {{}}        : {links_fixed}")
print(f"error response content : stripped {contents_stripped}")
print(f"schemas dropped        : {', '.join(schemas_dropped) or '(none)'}")
print(f"file size              : {path.stat().st_size:,} bytes")
