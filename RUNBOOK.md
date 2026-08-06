# Orgo API docs — Runbook

Operational guide for maintaining the docs at https://orgo.space/docs.

The repo holds two kinds of content:

- **Hand-written** Markdown / MDX pages under `platform/`, `api-reference/concepts/`, `api-reference/recipes/`, `changelog/`.
- **Auto-generated + enriched** OpenAPI spec at `api-reference/openapi.json`, regenerated from the Symfony backend and then post-processed by `scripts/postprocess-openapi.py` using manifests in `scripts/enrichment-data/`.

When you change anything, push to `main` and Mintlify auto-deploys.

---

## Routine 1 — Regenerate the OpenAPI spec from the backend

Run after any change to API Platform resources, controllers, or serialization groups in the Symfony app.

```bash
# 1. Export from the Symfony backend (run inside the api container)
docker exec orgo-php bin/console api:openapi:export \
  --output=json --spec-version=3.1 \
  > /Users/alex/api-docs/api-reference/openapi.json

# 2. Reapply all enrichment
cd /Users/alex/api-docs
python3 scripts/postprocess-openapi.py api-reference/openapi.json

# 3. Preview locally
mint dev

# 4. Commit and push — Mintlify deploys
git add api-reference/openapi.json
git commit -m "chore: regenerate openapi.json"
git push
```

### What the script does

Thirteen idempotent passes:

| Pass | What it does | Source of truth |
|---|---|---|
| 1-4 | Validator cleanup (`links: [] -> {}`, strip 4xx/5xx content, drop bad schemas) | (built-in) |
| 5-7 | `info.description`, `info.contact`, `info.license`, `info.termsOfService`, `servers[].url` | `enrichment-data/info.md` |
| 8-9 | `components.securitySchemes`, top-level `security:`, per-op anonymous opt-outs | `enrichment-data/security.yaml` |
| 10 | Tag descriptions | `enrichment-data/tags.yaml` |
| 11 | Traceability timestamp under `info.x-orgo-postprocessed` | (built-in) |
| 12 | Request + response examples (synthesized for all 743 ops, hand-curated for top 30) | `enrichment-data/examples.yaml` + `scripts/synthesize.py` |
| 13 | `x-codeSamples` (curl + JS + PHP) | `enrichment-data/code_samples.yaml` |
| 14 | `webhooks:` block + per-event schemas | `enrichment-data/webhooks.yaml` |

**Idempotent** — running it twice produces byte-identical output. Safe to re-run any time.

### Reading the output

```
links [] -> {}              : 0
error response content       : stripped 0
schemas dropped              : (none)
info.description bytes       : 8293
servers[0].url               : https://app.orgo.space
securitySchemes              : ApiToken, JWT, OAuth2, ContactHash
public operations            : 43 / 743
tag descriptions enriched    : 40
examples synthesized (req)   : 553
examples synthesized (resp)  : 1225
examples hand-curated (req)  : 55
examples hand-curated (resp) : 33
x-codeSamples injected       : 30
webhook events declared      : 18
file size                    : 5,247,267 bytes
```

Counts that change after a regen are normal — new endpoints are auto-covered by synthesis. Watch for:

- **`file size`** approaching 10 MB — Mintlify's hard limit. Currently at 50% headroom.
- **`public operations`** dropping significantly — probably means the backend renamed paths that were in `security.yaml`. Check the patterns.
- **`[stale]` warnings** at the bottom — hand-curated entries reference operationIds the backend no longer emits. See Troubleshooting below.

### What is and isn't safe to overwrite

- **Overwrite freely**: `info.description`, `info.contact`, `servers`, `securitySchemes`, tag descriptions, examples on a content-type. The script re-derives them from manifests.
- **Never edit directly**: `api-reference/openapi.json`. Edits get blown away on the next regen. Edit the manifest instead.

---

## Routine 2 — Add or update enrichment

All editable enrichment lives in `scripts/enrichment-data/`. After editing any file there, re-run `python3 scripts/postprocess-openapi.py api-reference/openapi.json`.

### Where each kind of edit goes

| To change... | Edit this file | Then run |
|---|---|---|
| The API overview prose | `info.md` | postprocess script |
| Auth scheme descriptions | `security.yaml` (`schemes:`) | postprocess script |
| Which endpoints are anonymous | `security.yaml` (`public:`) | postprocess script |
| A tag's description | `tags.yaml` | postprocess script |
| A request or response example | `examples.yaml` | postprocess script |
| Code samples for an endpoint | `code_samples.yaml` | postprocess script |
| Webhook event payload | `webhooks.yaml` | postprocess script |
| Synthesizer field-name patterns | `scripts/synthesize.py` | postprocess script |
| A concept page | `api-reference/concepts/*.mdx` | nothing — Mintlify picks it up |
| A recipe | `api-reference/recipes/*.mdx` | nothing — but add to `docs.json` if new |
| Navigation | `docs.json` | nothing |

### Adding a hand-curated example for the 31st endpoint

1. Find the operation's `operationId`:
   ```bash
   /Users/alex/api-docs/scripts/.venv/bin/python3 -c "
   import json; spec = json.load(open('/Users/alex/api-docs/api-reference/openapi.json'))
   for path, m in spec['paths'].items():
       for verb, op in m.items():
           if verb in ('get','post','put','patch','delete'):
               if 'YOUR_PATH_HERE' in path:
                   print(verb.upper(), path, '->', op.get('operationId'))
   "
   ```
2. Append to `scripts/enrichment-data/examples.yaml`:
   ```yaml
   - operationId: <the-id>
     request:
       "*":
         summary: "Short label"
         value: { ... your JSON ... }
     response:
       "200":
         application/json:
           value: { ... }
   ```
3. Re-run the postprocess script and check the per-operation page in `mint dev`.

### Adding code samples for a new endpoint

Append to `scripts/enrichment-data/code_samples.yaml`. Use the same persona (`acme.orgo.space`, `$ORGO_API_TOKEN`, James Patterson) so the docs stay consistent.

### Adding a new recipe page

1. Create `api-reference/recipes/<slug>.mdx`. Match the voice of existing recipes — second-person, concrete, with curl examples and a "Common gotchas" `<AccordionGroup>`.
2. Add the slug to `docs.json` under the API Reference tab's "Recipes" group:
   ```json
   "api-reference/recipes/<slug>"
   ```
3. Run `mint dev` and verify the page serves 200 at `/api-reference/recipes/<slug>`.

---

## Routine 3 — Add a new webhook event

When the backend ships a new event type:

1. Append the entry to `scripts/enrichment-data/webhooks.yaml` with `event`, `summary`, `description`, `object_example`, and `previous_attributes_example`.
2. Run the postprocess script. The output should show `webhook events declared : 19` (or however many).
3. The new event appears in the "Webhooks" section of the API Reference playground automatically.

No code changes needed.

---

## Troubleshooting

### `[stale] examples.yaml references operationIds not in the spec`

The backend renamed an operation. Either:

- **Update the entry** — find the new operationId and rename it in the YAML.
- **Remove the entry** — if the operation truly went away, drop the YAML block. Synthesis will cover anything left.

Until you do, the hand-curated content for that endpoint is silently ignored.

### `[stale] code_samples.yaml ...`

Same as above, but for `code_samples.yaml`. Same fix.

### `public entries with NO match in spec`

`security.yaml`'s `public:` list contains patterns the OpenAPI spec doesn't expose. Usually these are custom Symfony routes (login, OAuth callbacks, Stripe webhooks) that have no API Platform metadata — harmless, just clutter. Remove the ones that have been gone for a while.

### `PyYAML not installed` on first run

Self-resolves. The script bootstraps a local venv at `scripts/.venv/` on first run and installs PyYAML into it. If it fails, check that `python3 -m venv` works.

### `mint dev` shows `[TypeError: controller[kState].transformAlgorithm is not a function]`

Cosmetic. It's a Node 23/24 streaming-API change the Mintlify CLI hasn't caught up to. Pages still render correctly and production deploys are unaffected. Ignore unless `mint dev` stops serving pages entirely.

### File size approaching 10 MB

Mintlify's hard limit. Mitigations in order:

1. Reduce synthesizer depth — change `MAX_DEPTH = 6` in `scripts/synthesize.py` to `4` for response synthesis only (each level costs roughly 1 MB on the deepest endpoints).
2. Skip synthesis on a content-type — extend the "skip multipart-as-response" guard in `postprocess-openapi.py` to other content types.
3. Audit `components.schemas` for orphans — schemas with no `$ref` to them anywhere can be dropped.

### Mintlify build fails after push

Check the Mintlify dashboard for the validator error. Most failures fall into:

- **Invalid OpenAPI** — schema has `links: []` somewhere new (extend `fix_links` in the script).
- **Invalid MDX** — a recipe or concept page has unescaped JSX (`{` inside prose). Wrap problem strings in backticks or escape the brace.
- **Broken internal link** — a `[Foo](/api-reference/...)` points at a slug that doesn't exist. Mintlify won't fail the build but will warn; check the warnings tab.

---

## File layout

```
api-docs/
├── docs.json                              # Mintlify navigation + theme config
├── RUNBOOK.md                             # this file
├── README.md                              # public README
├── api-reference/
│   ├── openapi.json                       # AUTO-GENERATED — never edit
│   ├── introduction.mdx                   # (legacy, unwired — safe to delete)
│   ├── concepts/                          # hand-written conceptual docs
│   │   ├── authentication.mdx
│   │   ├── tenancy.mdx
│   │   ├── content-types.mdx
│   │   ├── pagination-and-filters.mdx
│   │   ├── errors.mdx
│   │   ├── rate-limits.mdx
│   │   └── webhooks.mdx
│   └── recipes/                           # hand-written end-to-end walkthroughs
│       └── *.mdx                          # (11 recipes)
├── platform/                              # hand-written admin / feature docs
├── changelog/                             # hand-written release notes
└── scripts/
    ├── postprocess-openapi.py             # the regen pipeline (13 passes)
    ├── synthesize.py                      # persona-aware schema synthesizer
    ├── .venv/                             # auto-created on first run
    └── enrichment-data/
        ├── info.md                        # API overview that becomes info.description
        ├── security.yaml                  # auth schemes + per-route overrides
        ├── tags.yaml                      # 40 hand-curated entity descriptions
        ├── examples.yaml                  # hand-curated request/response examples
        ├── code_samples.yaml              # curl + JS + PHP per endpoint
        └── webhooks.yaml                  # webhook event catalog
```

---

## Style notes

The docs voice across `concepts/` and `recipes/` is **second-person, concrete, no marketing copy**. Hand-curated examples use a single persona for continuity:

- Tenant `acme.orgo.space`, organization "Civic Collective"
- Local centers Boston (id 4), Manchester (id 7), San Francisco (id 12)
- Cast: James Patterson, Emma Whitfield, Sarah O'Connor, Michael Chen, Olivia Brown
- Anchor date 2026-01-15, currency USD, timezone America/New_York
- Emails on `@example.com` (RFC 2606 reserved); phones in NANP 555 fictional ranges

When adding a new recipe or example, reuse these. The docs tell a coherent story across endpoints.

---

## Known limitations to track for the roadmap

1. **Schema name explosion** — 204 `User-*` variants in `components.schemas` are auto-generated from API Platform serialization groups. Cosmetic for LLMs (the per-page `.md` mirrors are not affected), but bloats the OpenAPI playground's schema explorer. Fix requires renaming serializer groups in the Symfony backend.

2. **No per-plan rate limits in the application layer**. `concepts/rate-limits.mdx` documents this honestly. If the backend ships per-plan limits, update that page.

3. **The hand-curated layer covers the top 30 of 743 operations**. Everything else uses synthesized examples — solid but generic. To improve coverage, hand-curate more entries in `examples.yaml` and `code_samples.yaml` as demand surfaces.

---

## Closed limitations

**Webhook signature (closed 2026-08-05, backend `184c3a934`).** `X-Webhook-Signature` was a 31-bit non-keyed hash and the docs were deliberately silent about it, with signature questions routed to support privately. It is now HMAC-SHA256 in the shape `t=<unix_ts>,v1=<hex>` over `"<t>.<raw body>"` (`api/src/Entity/WebhookSubscription.php::generateSignature`). The silence posture is retired: verification is documented publicly in `platform/webhooks.mdx` ("Verifying the signature"), `api-reference/concepts/webhooks.mdx` ("Authenticating the sender") and `api-reference/recipes/handle-webhooks.mdx` (Step 3), and support can link to those pages.

One planned action item was **not** taken: the old header is not sent alongside the new one, so the change is breaking for any receiver that compared the old value. Every page that documents the signature says so, and the August 2026 changelog entry is written as "action required". If a customer reports a receiver that suddenly rejects everything, this is the first thing to check.
