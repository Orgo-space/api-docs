#!/usr/bin/env python3
"""
Post-process the Symfony / API Platform OpenAPI export and enrich it for
LLM-friendliness and Mintlify rendering.

The script is idempotent — running it twice on the same input produces the
same output. All enrichment data lives in `scripts/enrichment-data/` so the
generator can be re-run after every backend regeneration without losing
hand-curated content.

Passes (in order):

  Validator cleanup (original behavior)
    1. links: [] -> links: {}
    2. Strip `content` block from 4xx/5xx responses, keep only `description`
    3. Drop Error / ConstraintViolation schemas that trip Mintlify
    4. Normalize misc empty-list slots that should be maps

  Enrichment (new)
    5. Inject info.description from enrichment-data/info.md
    6. Inject info.contact + info.license + info.termsOfService
    7. Set servers[].url to production
    8. Inject components.securitySchemes from enrichment-data/security.yaml
    9. Apply default `security:` to every operation; mark public paths anonymous
   10. Inject tag descriptions from enrichment-data/tags.yaml
   11. Stamp `x-orgo-postprocessed: <ISO timestamp>` in info for traceability

  Size reduction (new)
   12. Drop `application/ld+json` and `multipart/form-data` content variants
       and any schema left unreferenced, so endpoint pages stay small enough
       that agents do not truncate them

Usage:
  ./postprocess-openapi.py path/to/openapi.json

Writes back minified JSON in place.
"""

import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from fnmatch import fnmatch
from pathlib import Path

# ─── Self-bootstrapping venv ─────────────────────────────────────────────────
#
# Homebrew Python is PEP 668-protected, so `pip install PyYAML` against the
# system interpreter fails. Create a script-local venv on first run, install
# PyYAML into it, and re-exec ourselves inside it. The venv is gitignored.

HERE = Path(__file__).resolve().parent
VENV = HERE / ".venv"
VENV_PY = VENV / "bin" / "python"


def ensure_venv():
    if not VENV.exists():
        print("[bootstrap] creating venv at", VENV, file=sys.stderr)
        subprocess.check_call([sys.executable, "-m", "venv", str(VENV)])
        pip = VENV / "bin" / "pip"
        subprocess.check_call(
            [str(pip), "install", "--quiet", "PyYAML==6.0.2"]
        )
    # `sys.executable` is the symlink path, but `Path.resolve()` follows it
    # to the system interpreter. The canonical way to detect a venv is to
    # compare `sys.prefix` (active env) with `sys.base_prefix` (interpreter
    # install root) and check that we are running under THIS specific venv.
    in_this_venv = (
        sys.prefix != sys.base_prefix
        and Path(sys.prefix).resolve() == VENV.resolve()
    )
    if not in_this_venv:
        os.execv(str(VENV_PY), [str(VENV_PY), __file__] + sys.argv[1:])


ensure_venv()
import yaml  # noqa: E402  (only available after ensure_venv)

sys.path.insert(0, str(HERE))
from synthesize import SchemaSynthesizer  # noqa: E402  (local module)


# ─── Args + load ─────────────────────────────────────────────────────────────

if len(sys.argv) != 2:
    sys.exit("usage: postprocess-openapi.py PATH_TO_OPENAPI_JSON")

OPENAPI_PATH = Path(sys.argv[1])
DATA_DIR = HERE / "enrichment-data"
INFO_MD = DATA_DIR / "info.md"
SECURITY_YAML = DATA_DIR / "security.yaml"
TAGS_YAML = DATA_DIR / "tags.yaml"
EXAMPLES_YAML = DATA_DIR / "examples.yaml"
CODE_SAMPLES_YAML = DATA_DIR / "code_samples.yaml"
WEBHOOKS_YAML = DATA_DIR / "webhooks.yaml"

PRODUCTION_BASE_URL = "https://app.orgo.space"
SUPPORT_EMAIL = "support@orgo.space"
PLATFORM_URL = "https://orgo.space"
DOCS_URL = "https://orgo.space/docs"

spec = json.loads(OPENAPI_PATH.read_text())


def load_yaml(path: Path) -> dict | list:
    if not path.exists():
        print(f"[warn] missing manifest: {path}", file=sys.stderr)
        return {}
    return yaml.safe_load(path.read_text())


# ─── Pass 1-4: validator cleanup (original behavior) ─────────────────────────

links_fixed = 0
contents_stripped = 0


def fix_links(node):
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

if spec.get("webhooks") == []:
    spec["webhooks"] = {}

components = spec.setdefault("components", {})
for slot in (
    "responses", "parameters", "examples", "requestBodies",
    "headers", "securitySchemes", "callbacks", "links",
):
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

schemas = components.setdefault("schemas", {})
schemas_dropped = []
for name in ("Error", "Error.jsonld", "ConstraintViolation", "ConstraintViolation.jsonld"):
    if name in schemas:
        del schemas[name]
        schemas_dropped.append(name)


# ─── Pass 5-7: top-level metadata ────────────────────────────────────────────

info = spec.setdefault("info", {})

if INFO_MD.exists():
    info["description"] = INFO_MD.read_text().rstrip() + "\n"
else:
    print(f"[warn] {INFO_MD} missing — info.description left as-is", file=sys.stderr)

info["title"] = "Orgo API"
info["version"] = info.get("version") or "1.0.0"
info["contact"] = {
    "name": "Orgo Support",
    "url": f"{DOCS_URL}/api-reference",
    "email": SUPPORT_EMAIL,
}
info["termsOfService"] = f"{PLATFORM_URL}/terms"
info["license"] = {
    "name": "Proprietary",
    "url": f"{PLATFORM_URL}/terms",
}

spec["servers"] = [
    {
        "url": PRODUCTION_BASE_URL,
        "description": "Production — replace with your tenant subdomain or custom domain for tenant-scoped calls (e.g. https://your-org.orgo.space).",
    }
]


# ─── Pass 8-9: security schemes and per-op defaults ──────────────────────────

security_manifest = load_yaml(SECURITY_YAML) or {}

schemes = security_manifest.get("schemes") or {}
if schemes:
    components.setdefault("securitySchemes", {}).clear()
    components["securitySchemes"].update(schemes)

default_security = security_manifest.get("default") or []
public_entries = security_manifest.get("public") or []

# Top-level security defines the global default that operations inherit.
spec["security"] = list(default_security)


def public_methods_for_path(path: str) -> set[str] | None:
    """Return the set of HTTP methods that should be anonymous for this path.

    - None  -> path is not in the public list; inherit default security.
    - set() -> path is public for all methods (returned as the empty set when
               no `methods:` restrictor is given; treated as "all methods").
    """
    matched: set[str] | None = None
    for entry in public_entries:
        if isinstance(entry, str):
            if fnmatch(path, entry):
                matched = set()  # all methods
        elif isinstance(entry, dict):
            pat = entry.get("path")
            methods = entry.get("methods") or []
            if pat and fnmatch(path, pat):
                # Lowercase + dedupe
                new_methods = {m.lower() for m in methods}
                if matched is None:
                    matched = new_methods
                elif matched == set():
                    pass  # already all methods, keep it that way
                else:
                    matched |= new_methods
        else:
            print(f"[warn] unsupported public entry: {entry!r}", file=sys.stderr)
    return matched

public_op_count = 0
total_ops = 0
unmatched_public_entries = []
matched_patterns: set[int] = set()

# Track which entries got at least one hit so we can warn about stale entries.
for idx, _ in enumerate(public_entries):
    matched_patterns.add(idx) if False else None  # placeholder, refined below

entry_hit = [False] * len(public_entries)

for path_url, methods in (spec.get("paths") or {}).items():
    if not isinstance(methods, dict):
        continue
    public_methods = public_methods_for_path(path_url)
    # Track hits per entry index (for staleness warning)
    for idx, entry in enumerate(public_entries):
        if isinstance(entry, str):
            if fnmatch(path_url, entry):
                entry_hit[idx] = True
        elif isinstance(entry, dict):
            pat = entry.get("path")
            if pat and fnmatch(path_url, pat):
                entry_hit[idx] = True
    for method, op in methods.items():
        if method not in ("get", "post", "put", "patch", "delete", "options", "head"):
            continue
        if not isinstance(op, dict):
            continue
        total_ops += 1
        is_method_public = (
            public_methods is not None
            and (public_methods == set() or method in public_methods)
        )
        if is_method_public:
            op["security"] = []  # opt out of default; mark anonymous
            public_op_count += 1
        else:
            op.pop("security", None)  # rely on top-level default

for idx, hit in enumerate(entry_hit):
    if not hit:
        ent = public_entries[idx]
        label = ent if isinstance(ent, str) else ent.get("path", repr(ent))
        unmatched_public_entries.append(label)


# ─── Pass 10: tag descriptions ───────────────────────────────────────────────

tag_descriptions = load_yaml(TAGS_YAML) or {}

# Build a name -> existing-tag map so we preserve ordering and other fields.
existing_tags = spec.get("tags") or []
existing_by_name = {t["name"]: t for t in existing_tags if isinstance(t, dict) and "name" in t}

tags_enriched = 0
for name, description in tag_descriptions.items():
    description = description.rstrip()
    if name in existing_by_name:
        existing_by_name[name]["description"] = description
        tags_enriched += 1
    else:
        # Tag mentioned in manifest but not yet emitted by API Platform.
        # Append it so the description still surfaces if/when ops adopt it.
        existing_tags.append({"name": name, "description": description})
        existing_by_name[name] = existing_tags[-1]
        tags_enriched += 1

spec["tags"] = existing_tags


# ─── Pass 12: synthesize request/response examples ───────────────────────────
#
# For every operation, walk the schema of each request body content-type and
# each 2xx response content-type, synthesize a JSON example, and inject it on
# the schema's `example` field. Hand-curated overrides from examples.yaml win.

examples_manifest = load_yaml(EXAMPLES_YAML) or {}
manual_examples = {}
for entry in (examples_manifest.get("operations") or []):
    op_id = entry.get("operationId")
    if op_id:
        manual_examples[op_id] = entry

synthesizer = SchemaSynthesizer(schemas)
example_stats = {"synth_req": 0, "synth_resp": 0, "manual_req": 0, "manual_resp": 0}


def inject_example(content_block: dict, value, summary: str | None = None) -> None:
    """Set or replace the `example` field on a content-type block.

    Mintlify renders this in the playground. We always overwrite — the
    synthesizer is deterministic and any manual override wins.
    """
    if value is None:
        return
    content_block["example"] = value
    if summary:
        content_block["x-orgo-example-summary"] = summary


def synthesize_for(schema_ref_or_inline, for_write: bool):
    if not schema_ref_or_inline:
        return None
    try:
        return synthesizer.synthesize(schema_ref_or_inline, for_write=for_write)
    except Exception as exc:                              # pragma: no cover
        print(f"[warn] synth failed for {schema_ref_or_inline!r}: {exc}", file=sys.stderr)
        return None


for path_url, methods in (spec.get("paths") or {}).items():
    if not isinstance(methods, dict):
        continue
    for method, op in methods.items():
        if method not in ("get", "post", "put", "patch", "delete"):
            continue
        if not isinstance(op, dict):
            continue

        op_id = op.get("operationId")
        manual = manual_examples.get(op_id) or {}

        # ── request body ─────────────────────────────────────────────────────
        rb = op.get("requestBody") or {}
        for content_type, content_block in (rb.get("content") or {}).items():
            if not isinstance(content_block, dict):
                continue
            schema_block = content_block.get("schema") or {}

            override = ((manual.get("request") or {}).get(content_type)
                        or (manual.get("request") or {}).get("*"))
            if override and "value" in override:
                inject_example(content_block, override["value"], override.get("summary"))
                example_stats["manual_req"] += 1
                continue

            example = synthesize_for(schema_block, for_write=True)
            if example is not None:
                inject_example(content_block, example)
                example_stats["synth_req"] += 1

        # ── 2xx responses ────────────────────────────────────────────────────
        for status_code, resp_body in (op.get("responses") or {}).items():
            try:
                code_int = int(status_code)
            except (TypeError, ValueError):
                continue
            if code_int < 200 or code_int >= 300:
                continue
            if not isinstance(resp_body, dict):
                continue
            for content_type, content_block in (resp_body.get("content") or {}).items():
                if not isinstance(content_block, dict):
                    continue
                # Skip multipart-as-response: it's an API Platform artifact
                # of accepting multipart requests; nobody consumes a multipart
                # response and the example would just duplicate application/json
                # while inflating file size and the playground.
                if content_type == "multipart/form-data":
                    continue
                schema_block = content_block.get("schema") or {}

                override_root = (manual.get("response") or {}).get(str(code_int)) or {}
                override = override_root.get(content_type) or override_root.get("*")
                if override and "value" in override:
                    inject_example(content_block, override["value"], override.get("summary"))
                    example_stats["manual_resp"] += 1
                    continue

                example = synthesize_for(schema_block, for_write=False)
                if example is not None:
                    inject_example(content_block, example)
                    example_stats["synth_resp"] += 1


# ─── Pass 13: x-codeSamples ──────────────────────────────────────────────────
#
# Inject curl + JS + PHP snippets on the operations listed in code_samples.yaml.
# Mintlify renders these as language tabs in the playground.

code_samples_manifest = load_yaml(CODE_SAMPLES_YAML) or {}
code_samples_by_op = {}
for entry in (code_samples_manifest.get("operations") or []):
    op_id = entry.get("operationId")
    if op_id and entry.get("samples"):
        code_samples_by_op[op_id] = entry["samples"]

code_samples_injected = 0
spec_op_ids: set[str] = set()
for path_url, methods in (spec.get("paths") or {}).items():
    if not isinstance(methods, dict):
        continue
    for method, op in methods.items():
        if method not in ("get", "post", "put", "patch", "delete"):
            continue
        if not isinstance(op, dict):
            continue
        op_id = op.get("operationId")
        if op_id:
            spec_op_ids.add(op_id)
        if op_id in code_samples_by_op:
            op["x-codeSamples"] = code_samples_by_op[op_id]
            code_samples_injected += 1

# Staleness detection: warn if a manifest references an operationId the
# regenerated spec no longer contains (typical cause: backend renamed an
# operation in a refactor; the hand-curated entry becomes orphaned).
stale_examples = sorted(op_id for op_id in manual_examples if op_id not in spec_op_ids)
stale_code_samples = sorted(op_id for op_id in code_samples_by_op if op_id not in spec_op_ids)


# ─── Pass 14: inject webhooks block + per-event schemas ──────────────────────
#
# Builds the OpenAPI 3.1 top-level `webhooks:` block from webhooks.yaml.
# Each event becomes one `Webhook.<EventName>` schema in components, plus
# a `webhooks: { <event>: { post: ... } }` entry pointing at the schema.

webhooks_manifest = load_yaml(WEBHOOKS_YAML) or {}
webhook_events = webhooks_manifest.get("events") or []

webhooks_block = {}
webhook_schemas_added = 0

ENVELOPE_PROPS = {
    "id": {
        "type": "string",
        "description": "Unique delivery identifier — log this to correlate with Orgo's delivery dashboard.",
        "example": "wh_evt_67aa128c2f4a",
    },
    "event": {
        "type": "string",
        "description": "The event type — e.g. `user.created`, `product_payment.updated`.",
    },
    "api_version": {
        "type": "string",
        "description": "Webhook payload schema version.",
        "example": "2024-01",
    },
    "created": {
        "type": "integer",
        "description": "Unix timestamp (seconds) of when the delivery was sent.",
        "example": 1735689600,
    },
    "tenant_id": {
        "type": "integer",
        "description": "ID of the Orgo tenant the event belongs to. Use this to route deliveries in a multi-tenant receiver.",
        "example": 1,
    },
    "request": {
        "type": "object",
        "description": "Metadata about the API request that triggered the event (when applicable).",
        "properties": {
            "id": {"type": "string", "example": "req_8c2f4a67aa12"},
        },
    },
    "is_update": {
        "type": "boolean",
        "description": "True for `*.updated` events, false otherwise.",
        "example": False,
    },
    "entity_type": {
        "type": "string",
        "description": "The entity family — e.g. `user`, `product_payment`, `contact`.",
        "example": "user",
    },
    "operation": {
        "type": "string",
        "description": "The operation — `created`, `updated`, or `deleted`.",
        "enum": ["created", "updated", "deleted"],
    },
}

def event_name_to_schema(event_name: str) -> str:
    """user.created -> Webhook.UserCreated"""
    parts = event_name.replace(".", "_").split("_")
    return "Webhook." + "".join(p.capitalize() for p in parts)


for entry in webhook_events:
    event = entry.get("event")
    if not event:
        continue
    schema_name = event_name_to_schema(event)
    object_example = entry.get("object_example") or {}
    previous_example = entry.get("previous_attributes_example")

    # Build the full envelope schema.
    envelope_schema = {
        "type": "object",
        "required": ["id", "event", "api_version", "created", "tenant_id", "object"],
        "properties": {
            **{k: dict(v) for k, v in ENVELOPE_PROPS.items()},
            "object": {
                "type": "object",
                "description": "Snapshot of the entity at the moment the event was emitted.",
                "additionalProperties": True,
                "example": object_example,
            },
            "previous_attributes": {
                "description": "Diff against the prior state. Only fields that changed are present. `null` for created/deleted events.",
                "type": ["object", "null"],
                "additionalProperties": True,
                "example": previous_example,
            },
        },
    }
    envelope_schema["properties"]["event"]["enum"] = [event]
    envelope_schema["properties"]["event"]["example"] = event

    # Top-level example body so Mintlify renders it in the webhook playground.
    full_example = {
        "id": "wh_evt_67aa128c2f4a",
        "event": event,
        "api_version": "2024-01",
        "created": 1735689600,
        "tenant_id": 1,
        "request": {"id": "req_8c2f4a67aa12"},
        "object": object_example,
        "previous_attributes": previous_example,
        "is_update": event.endswith(".updated"),
        "entity_type": event.split(".")[0],
        "operation": event.split(".")[1],
    }
    envelope_schema["example"] = full_example

    schemas[schema_name] = envelope_schema
    webhook_schemas_added += 1

    # Webhook operation entry.
    webhooks_block[event] = {
        "post": {
            "summary": entry.get("summary") or event,
            "description": (entry.get("description") or "").strip(),
            "tags": ["Webhooks"],
            "requestBody": {
                "required": True,
                "content": {
                    "application/json": {
                        "schema": {"$ref": f"#/components/schemas/{schema_name}"},
                        "example": full_example,
                    },
                },
            },
            "responses": {
                "200": {
                    "description": "Acknowledged. Any 2xx tells Orgo the delivery succeeded.",
                },
                "4XX": {
                    "description": "Receiver rejected the delivery. Orgo retries up to 3 times with exponential backoff.",
                },
                "5XX": {
                    "description": "Receiver errored. Orgo retries up to 3 times with exponential backoff.",
                },
            },
        }
    }

if webhooks_block:
    spec["webhooks"] = webhooks_block


# ─── Pass 11: traceability stamp ─────────────────────────────────────────────

info["x-orgo-postprocessed"] = datetime.now(timezone.utc).isoformat(timespec="seconds")


# ─── Pass 12: prune redundant content-type variants ──────────────────────────
#
# API Platform emits every operation three times over: application/json,
# application/ld+json and multipart/form-data, each with its own generated
# schema variant (User, User.jsonld, User.multipart, plus one per
# serialization group). That tripling is what pushes endpoint pages to ~2MB of
# HTML / 169K of markdown, past the point where agents truncate them.
#
# We keep application/json (and merge-patch/csv, which are not duplicates) and
# drop the two variants. This extends the same reasoning the response-side
# multipart guard above already applies. The alternative content types remain
# documented in api-reference/concepts/content-types.
#
# A content-type is only removed when at least one other remains, so an
# endpoint that *only* accepts multipart (file upload) keeps its schema.

PRUNE_CONTENT_TYPES = {"application/ld+json", "multipart/form-data"}

content_types_pruned = 0


def prune_content_types(node):
    global content_types_pruned
    if isinstance(node, dict):
        block = node.get("content")
        if isinstance(block, dict):
            survivors = [m for m in block if m not in PRUNE_CONTENT_TYPES]
            if survivors:
                for media in [m for m in block if m in PRUNE_CONTENT_TYPES]:
                    del block[media]
                    content_types_pruned += 1
        for value in node.values():
            prune_content_types(value)
    elif isinstance(node, list):
        for item in node:
            prune_content_types(item)


prune_content_types(spec.get("paths", {}))
prune_content_types(spec.get("webhooks", {}))

# Drop schemas that nothing references any more. Walk transitively: a surviving
# schema may itself point at others.
all_schemas = components.get("schemas", {})


def collect_refs(node, into):
    if isinstance(node, dict):
        ref = node.get("$ref")
        if isinstance(ref, str) and ref.startswith("#/components/schemas/"):
            into.add(ref.rsplit("/", 1)[-1])
        for value in node.values():
            collect_refs(value, into)
    elif isinstance(node, list):
        for item in node:
            collect_refs(item, into)


reachable: set[str] = set()
collect_refs(spec.get("paths", {}), reachable)
collect_refs(spec.get("webhooks", {}), reachable)
frontier = set(reachable)
while frontier:
    nxt: set[str] = set()
    for name in frontier:
        if name in all_schemas:
            collect_refs(all_schemas[name], nxt)
    frontier = nxt - reachable
    reachable |= nxt

schemas_before = len(all_schemas)
components["schemas"] = {k: v for k, v in all_schemas.items() if k in reachable}
schemas_pruned = schemas_before - len(components["schemas"])


# ─── Write back ──────────────────────────────────────────────────────────────

OPENAPI_PATH.write_text(json.dumps(spec, ensure_ascii=False, separators=(",", ":")))


# ─── Report ──────────────────────────────────────────────────────────────────

print(f"links [] -> {{}}              : {links_fixed}")
print(f"error response content       : stripped {contents_stripped}")
print(f"schemas dropped              : {', '.join(schemas_dropped) or '(none)'}")
print(f"info.description bytes       : {len(info.get('description', ''))}")
print(f"servers[0].url               : {spec['servers'][0]['url']}")
print(f"securitySchemes              : {', '.join(components.get('securitySchemes', {}).keys()) or '(none)'}")
print(f"public operations            : {public_op_count} / {total_ops}")
if unmatched_public_entries:
    print("public entries with NO match in spec (stale or intentional):")
    for label in unmatched_public_entries:
        print(f"  - {label}")
print(f"tag descriptions enriched    : {tags_enriched}")
print(f"examples synthesized (req)   : {example_stats['synth_req']}")
print(f"examples synthesized (resp)  : {example_stats['synth_resp']}")
print(f"examples hand-curated (req)  : {example_stats['manual_req']}")
print(f"examples hand-curated (resp) : {example_stats['manual_resp']}")
print(f"x-codeSamples injected       : {code_samples_injected}")
print(f"webhook events declared      : {webhook_schemas_added}")
print(f"content variants pruned      : {content_types_pruned}")
print(f"schemas pruned (unreferenced): {schemas_pruned} of {schemas_before}")
print(f"file size                    : {OPENAPI_PATH.stat().st_size:,} bytes")
if stale_examples:
    print(f"\n[stale] examples.yaml references operationIds not in the spec:")
    for op_id in stale_examples:
        print(f"  - {op_id}")
    print("  -> hand-curated examples for these will be ignored.")
    print("  -> either remove the entry, or update operationId if the backend renamed it.")
if stale_code_samples:
    print(f"\n[stale] code_samples.yaml references operationIds not in the spec:")
    for op_id in stale_code_samples:
        print(f"  - {op_id}")
    print("  -> x-codeSamples for these will not appear in the playground.")
    print("  -> either remove the entry, or update operationId if the backend renamed it.")
