# Screenshot remediation brief

An audit opened all 278 documentation screenshots and found: wrong screens (a click silently
failed, so the shot is of the page before it), empty states where the feature is the subject,
thin data that makes the product look unused, stale files that were never recaptured, alt text
that describes something not in frame, and residual content from the real organizations the
demo data was cloned from.

You are fixing one area. Your audit report names every problem in it.

## Instance rules (breaking these is the worst outcome here)

Work **only** against the orgo-1 documentation instance:

| Use | Never use |
|---|---|
| `docker exec orgo-1-php ...` | `orgo-php`, `orgo-database` |
| `http://localhost:8105` | `http://localhost:8095` |
| `/Users/alex/orgo-instance-1` (read-only, for code) | `/Users/alex/orgo` |

The unprefixed containers are the owner's main development environment. Before your first
database write, confirm the marker:

```
docker exec orgo-1-php bin/console dbal:run-sql "SELECT note FROM docs_instance_marker"
```

If that returns nothing, **stop and report**. Do not write.

## Do not

- Do NOT spawn subagents. A previous run died that way.
- Do NOT modify product code under `/Users/alex/orgo-instance-1` (read it freely).
- Do NOT edit `docs.json`.
- Do NOT commit or push.
- Do NOT capture from any tenant other than the demo organization, **Northwind Professional
  Association** (slug `t187c`). The tenants `oncr`, `preper`, `ila`, `oceanic-global` and
  `romanian-business-leaders` are real organizations and are banned as screenshot sources.

## What you may change

1. **Demo data**, through `docker exec orgo-1-php bin/console dbal:run-sql "..."`. Seed rows,
   turn on module flags, fill empty fields, replace residual real-world content with fictional
   equivalents. Members already on the tenant use `@example.org`; keep to that.
2. **Capture specs** in `.../scratchpad/docs-pass/specs/*.json`: fix routes, actions, `waitFor`
   values, viewport. Set `"status": "new"` on anything you want recaptured.
3. **Documentation prose and alt text** in `/Users/alex/api-docs/platform/**/*.mdx`, where the
   text over-claims or contradicts the image. No em or en dashes anywhere.

## Recapture and verify

```
cd /private/tmp/claude-501/-Users-alex-orgo-instance-1/1a6868c1-606b-4c1d-8e5c-cecdefd06316/scratchpad/docs-pass/capture
node run.mjs <specfile>            # whole file
node run.mjs <specfile> <specid>   # one spec
```

The runner prints `DUPLICATE IMAGES` and `ACTIONS THAT DID NOT RUN`. Both must be empty for
your specs when you finish. A `waitFor MISSED` warning means the shot is suspect: check it.

**Verification means opening the resulting PNG with the Read tool and looking at it.** A
database query proving the rows exist is not evidence that the screenshot shows them: that
exact mistake shipped a two-row queue after a 28-row seed, because the list filtered on
something the seed did not satisfy. Iterate until the image itself is right.

Useful action verbs in specs: `click`, `fill`, `wait`, `waitFor`, `press`, `hover`, `scroll`,
`scrollto`. A selector starting with `.`, `#` or `[` is treated as CSS; anything else is
matched as visible text. Two traps worth knowing: a `waitFor` that matches a string already on
the page fires before your action has had any effect (`Add (` matches `Add (0)`), and a click
on an element behind an overlay times out silently.

## Report

State, per image you touched: what was wrong, what you changed (data, spec, prose), and what
the final image shows. List anything you could not fix and why. Be honest about partial
fixes: an unfixable screen described accurately in prose is a better outcome than a
screenshot that quietly misleads.
