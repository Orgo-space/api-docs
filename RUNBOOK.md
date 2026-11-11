# Orgo API docs runbook

Operational guide for maintaining the docs at https://orgo.space/docs.

The repo holds two kinds of content:

- **Hand-written** Markdown / MDX pages under `platform/`, `api-reference/concepts/`, `api-reference/recipes/`, `changelog/`.
- **Auto-generated + enriched** OpenAPI spec at `api-reference/openapi.json`, regenerated from the Symfony backend and then post-processed by `scripts/postprocess-openapi.py` using manifests in `scripts/enrichment-data/`.

When you change anything, push to `main` and Mintlify auto-deploys.

---

## Routine 1: regenerate the OpenAPI spec from the backend

Run after any change to API Platform resources, controllers, or serialization groups in the Symfony app.

The container's `vendor/` has to match the checkout first. If the export dies with `Class "Doctrine\Bundle\MigrationsBundle\DoctrineMigrationsBundle" not found` or similar, the checkout has moved ahead of the container: `docker exec orgo-1-php sh -c 'cd /srv/api && composer install --no-interaction'`, then export.

```bash
# 1. Export from the Symfony backend.
#    -o takes a FILE PATH, not a format: `--output=json` writes a file called
#    "json" inside the container and leaves you with "[OK] Data written to json."
#    in your redirect. JSON is the default format (-y switches to YAML), and
#    --spec-version takes 2 or 3, not 3.1 (it emits 3.1.0 for 3).
#    Use orgo-1-php for docs work; orgo-php is the main dev instance.
docker exec orgo-1-php php -d memory_limit=1G bin/console api:openapi:export \
  --spec-version=3 --output=/tmp/openapi-fresh.json
docker cp orgo-1-php:/tmp/openapi-fresh.json \
  /Users/alex/api-docs/api-reference/openapi.json

# 2. Reapply all enrichment
cd /Users/alex/api-docs
python3 scripts/postprocess-openapi.py api-reference/openapi.json

# 3. Preview locally
mint dev

# 4. Commit and push, and Mintlify deploys
git add api-reference/openapi.json
git commit -m "chore: regenerate openapi.json"
git push
```

### What the script does

Sixteen idempotent passes:

| Pass | What it does | Source of truth |
|---|---|---|
| 1-4 | Validator cleanup (`links: [] -> {}`, strip 4xx/5xx content, drop bad schemas) | (built-in) |
| 5-7 | `info.description`, `info.contact`, `info.license`, `info.termsOfService`, `servers[].url` | `enrichment-data/info.md` |
| 8-9 | `components.securitySchemes`, top-level `security:`, per-op anonymous opt-outs | `enrichment-data/security.yaml` |
| 10 | Tag descriptions | `enrichment-data/tags.yaml` |
| 11 | Request + response examples (synthesized across the spec, hand-curated for the top operations). An example that synthesizes to `{}` or `[]` is skipped: it only prefills the playground with an empty body | `enrichment-data/examples.yaml` + `scripts/synthesize.py` |
| 12 | Repairs operations the backend hand-declares: a `requestBody` with no `content`, and parameters whose `schema` is `[]`. Both are invalid under OpenAPI 3.1 and either one makes Mintlify reject the entire file | (built-in) |
| 13 | `x-codeSamples` (curl + JS + PHP) | `enrichment-data/code_samples.yaml` |
| 14 | `webhooks:` block + per-event schemas | `enrichment-data/webhooks.yaml` |
| 15 | Traceability timestamp under `info.x-orgo-postprocessed` | (built-in) |
| 16 | Drop redundant content-type variants and unreferenced schemas | (built-in) |

**Always run it on a raw export, never on its own output.** Re-running it over an already-processed spec is safe but lossy: pass 16 prunes `application/ld+json` and `multipart/form-data`, so on a second pass the hand-curated entries that targeted those content types have nothing to attach to and silently drop out. On this spec that is the difference between 53 and 21 hand-curated request examples, with no warning. Export fresh, process once.

Processing the same raw export twice does give the same output apart from the traceability timestamp.

### Reading the output

```
links [] -> {}              : 0
error response content       : stripped 0
schemas dropped              : (none)
info.description bytes       : 8293
servers[0].url               : https://app.orgo.space
securitySchemes              : ApiToken, JWT, OAuth2, ContactHash
public operations            : 43 / 915
tag descriptions enriched    : 44
examples synthesized (req)   : 620
examples synthesized (resp)  : 1423
examples hand-curated (req)  : 53
examples hand-curated (resp) : 32
contentless bodies repaired  : 18
param schemas repaired       : 0
x-codeSamples injected       : 30
webhook events declared      : 18
content variants pruned      : 1808
schemas pruned (unreferenced): 1584 of 2630
file size                    : 3,202,074 bytes
```

That is a real run, 2026-11-11: 594 paths and 915 operations in, 1046 schemas left after pruning. The `contentless bodies repaired : 18` line is the website endpoints described under Troubleshooting; expect a non-zero count on every fresh export until the backend factory passes real schemas.

Counts that change after a regen are normal, because new endpoints are auto-covered by synthesis. Watch for:

- **`file size`** growing by more than a megabyte in one regeneration. There is headroom at 2.5 MB and size has never been the thing that broke a build, so treat a jump as a signal that synthesis has gone deep somewhere new, not as an emergency.
- **`public operations`** dropping significantly, which probably means the backend renamed paths that were in `security.yaml`. Check the patterns.
- **`[stale]` warnings** at the bottom: hand-curated entries reference operationIds the backend no longer emits. See Troubleshooting below.

### What is and isn't safe to overwrite

- **Overwrite freely**: `info.description`, `info.contact`, `servers`, `securitySchemes`, tag descriptions, examples on a content-type. The script re-derives them from manifests.
- **Never edit directly**: `api-reference/openapi.json`. Edits get blown away on the next regen. Edit the manifest instead.

---

## Routine 2: add or update enrichment

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
| A concept page | `api-reference/concepts/*.mdx` | nothing, Mintlify picks it up |
| A recipe | `api-reference/recipes/*.mdx` | nothing, but add to `docs.json` if new |
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

1. Create `api-reference/recipes/<slug>.mdx`. Match the voice of existing recipes: second person, concrete, with curl examples and a "Common gotchas" `<AccordionGroup>`.
2. Add the slug to `docs.json` under the API Reference tab's "Recipes" group:
   ```json
   "api-reference/recipes/<slug>"
   ```
3. Run `mint dev` and verify the page serves 200 at `/api-reference/recipes/<slug>`.

---

## Routine 3: add a new webhook event

When the backend ships a new event type:

1. Append the entry to `scripts/enrichment-data/webhooks.yaml` with `event`, `summary`, `description`, `object_example`, and `previous_attributes_example`.
2. Run the postprocess script. The output should show `webhook events declared : 19` (or however many).
3. The new event appears in the "Webhooks" section of the API Reference playground automatically.

No code changes needed.

---

## Troubleshooting

### `[stale] examples.yaml references operationIds not in the spec`

The backend renamed an operation. Either:

- **Update the entry.** Find the new operationId and rename it in the YAML.
- **Remove the entry.** If the operation truly went away, drop the YAML block. Synthesis will cover anything left.

Until you do, the hand-curated content for that endpoint is silently ignored.

### `[stale] code_samples.yaml ...`

Same as above, but for `code_samples.yaml`. Same fix.

### `public entries with NO match in spec`

`security.yaml`'s `public:` list contains patterns the OpenAPI spec doesn't expose. Usually these are custom Symfony routes (login, OAuth callbacks, Stripe webhooks) that have no API Platform metadata, so they are harmless clutter. Remove the ones that have been gone for a while.

### `PyYAML not installed` on first run

Self-resolves. The script bootstraps a local venv at `scripts/.venv/` on first run and installs PyYAML into it. If it fails, check that `python3 -m venv` works.

### `mint dev` shows `[TypeError: controller[kState].transformAlgorithm is not a function]`

Cosmetic. It's a Node 23/24 streaming-API change the Mintlify CLI hasn't caught up to. Pages still render correctly and production deploys are unaffected. Ignore unless `mint dev` stops serving pages entirely.

### "Failed to fetch OpenAPI file for anchor or tab", and nothing deploys

The single most expensive failure in this repo, so read this before doing anything else.

One invalid construct anywhere in `openapi.json` makes Mintlify reject the **whole** file. The hosted build log ends:

```
Fetched 0 OpenApi file(s)
Fetched 0 AsyncApi file(s)
Failed to fetch OpenAPI file for anchor or tab
```

and locally `mint dev` says `Openapi file api-reference/openapi.json defined in tab in your docs.json does not exist`, which is misleading: the file is right there. **The whole site stops deploying, not just the API tab**, so unrelated pages pushed in the same period silently never go live. Check the Mintlify dashboard after any push that touches the spec.

**Do not start by bisecting the file, and do not assume size.** Run a real validator:

```bash
python3 -m venv /tmp/oasvenv && /tmp/oasvenv/bin/pip install -q openapi-spec-validator
/tmp/oasvenv/bin/python -c "
import json
from openapi_spec_validator import OpenAPIV31SpecValidator
d = json.load(open('/Users/alex/api-docs/api-reference/openapi.json'))
for e in OpenAPIV31SpecValidator(d).iter_errors():
    print('/'.join(str(x) for x in e.absolute_path), '->', e.message[:120])
"
```

A venv is needed because Homebrew Python is PEP 668 locked.

Then separate the fatal errors from the noise:

| Validator message | Verdict |
|---|---|
| `[] is not of type 'object', 'boolean'` on a `schema` | **Fatal.** Pass 12 repairs the known cases |
| A `requestBody` with no `content` key | **Fatal.** Pass 12 repairs it |
| `links: []` where a map is expected | **Fatal.** Extend `fix_links` in the script |
| An example value whose type does not match its schema | Harmless |
| `N is greater than the maximum of 100` on an example | Harmless |
| `Path parameter 'x' ... was not resolved` | Harmless |

Roughly 86 of the harmless kind sit in the spec permanently and it builds fine, so a non-empty validator run is not itself a problem. Only the structural errors matter.

**Where fatal ones come from.** Anything the backend declares by hand rather than through API Platform metadata. `api/src/OpenApi/WebsiteOpenApiFactory.php` builds the website endpoints with `new RequestBody('...')` and `new Parameter($name, $in, $description, $required)`, never reaching the schema argument, so API Platform serialises 17 contentless bodies and 13 parameters with `schema: []`. Pass 12 repairs both on every run, so a regeneration cannot reintroduce them, but the PHP still emits the bad shapes: a new hand-written OpenAPI factory is the first suspect for a new fatal error.

### Mintlify build fails after push, with the API reference intact

- **Invalid MDX.** A page has unescaped JSX: a bare `{` in prose. Wrap it in backticks.
- **Broken internal link.** A `[Foo](/api-reference/...)` points at a slug that does not exist. This warns rather than failing; check the warnings tab.
- **A page missing from `docs.json`**, or a `docs.json` entry with no file behind it.

---

## File layout

```
api-docs/
├── docs.json                              # Mintlify navigation + theme config
├── RUNBOOK.md                             # this file
├── README.md                              # public README
├── api-reference/
│   ├── openapi.json                       # AUTO-GENERATED, never edit
│   ├── introduction.mdx                   # (legacy, unwired, safe to delete)
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

1. **Schema name explosion.** 204 `User-*` variants in `components.schemas` are auto-generated from API Platform serialization groups. Cosmetic for LLMs (the per-page `.md` mirrors are not affected), but bloats the OpenAPI playground's schema explorer. Fix requires renaming serializer groups in the Symfony backend.

2. **No per-plan rate limits in the application layer**. `concepts/rate-limits.mdx` documents this honestly. If the backend ships per-plan limits, update that page.

3. **The hand-curated layer covers a few dozen of 792 operations**. Everything else uses synthesized examples, which are solid but generic. To improve coverage, hand-curate more entries in `examples.yaml` and `code_samples.yaml` as demand surfaces.

---

## Closed limitations

**Webhook signature (closed 2026-08-05, backend `184c3a934`).** `X-Webhook-Signature` was a 31-bit non-keyed hash and the docs were deliberately silent about it, with signature questions routed to support privately. It is now HMAC-SHA256 in the shape `t=<unix_ts>,v1=<hex>` over `"<t>.<raw body>"` (`api/src/Entity/WebhookSubscription.php::generateSignature`). The silence posture is retired: verification is documented publicly in `platform/webhooks.mdx` ("Verifying the signature"), `api-reference/concepts/webhooks.mdx` ("Authenticating the sender") and `api-reference/recipes/handle-webhooks.mdx` (Step 3), and support can link to those pages.

One planned action item was **not** taken: the old header is not sent alongside the new one, so the change is breaking for any receiver that compared the old value. Every page that documents the signature says so, and the August 2026 changelog entry is written as "action required". If a customer reports a receiver that suddenly rejects everything, this is the first thing to check.
