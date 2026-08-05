# Orgo Platform Docs Accuracy Pass — Shared Agent Brief

You are one of ~36 agents updating Orgo's **platform documentation** (the user-facing product docs,
not the API reference) so it matches the product as it actually exists on `master`.

## Instance discipline (read this first)

There are two Orgo checkouts and two full sets of Docker containers on this machine.
**All docs work belongs to the `orgo-1` instance. The unprefixed one is the owner's main
development environment: never read from it, never write to it, never capture from it.**

| | Docs instance (USE THIS) | Main dev instance (DO NOT TOUCH) |
|---|---|---|
| Checkout | `/Users/alex/orgo-instance-1` (branch `docs_update`) | `/Users/alex/orgo` |
| Containers | `orgo-1-php`, `orgo-1-database`, `orgo-1-frontend` | `orgo-php`, `orgo-database`, `orgo-frontend` |
| Frontend | `http://localhost:8105` | `http://localhost:8095` |
| MySQL | port 3319 | port 3309 |

Consequences of getting this wrong, which already happened once: the obfuscation pass ran
against the owner's main development database, and their own branch switches and dump
restores showed up mid-capture as a "live" database and a red webpack error overlay.

The capture scripts default to `http://localhost:8105` and honour `ORGO_FRONTEND`.
For SQL, use `docker exec orgo-1-php bin/console dbal:run-sql "..."`.

## Repos and paths

| What | Path |
|---|---|
| Docs repo (edit here) | `/Users/alex/api-docs` — already on branch `docs/platform-accuracy-pass` |
| Platform pages | `/Users/alex/api-docs/platform/**/*.mdx` |
| Images | `/Users/alex/api-docs/images/platform/**` |
| Product code (source of truth) | `/Users/alex/orgo-instance-1` (branch `docs_update`) |
| Your report | `/private/tmp/claude-501/-Users-alex-orgo-instance-1/1a6868c1-606b-4c1d-8e5c-cecdefd06316/scratchpad/docs-pass/reports/<area>.md` |
| Your screenshot specs | `/private/tmp/claude-501/-Users-alex-orgo-instance-1/1a6868c1-606b-4c1d-8e5c-cecdefd06316/scratchpad/docs-pass/specs/<area>.json` |

## Decisions already made (do not re-litigate)

1. **Scope** = everything a tenant admin or member can reach in the UI on master, including
   module-gated features (say "requires the X module") and role-gated ones (say which permission).
   Orgo-internal superadmin tooling is out of scope.
2. **False claims get deleted**, and every deletion is logged in your report with the evidence that
   the feature does not exist. Do not leave "coming soon" hedges.
3. **URLs are stable.** Never rename or move an existing `.mdx` file. New pages are fine.
   Do **not** edit `docs.json` — propose nav placement in your report instead; it is merged centrally
   to avoid 36-way conflicts.
4. **Keep discoverability, cut filler, but do not chase a word count.** Keep frontmatter
   (`title`, `description`, `og:*`, `twitter:*`) and the short "**Built for** … / **Replaces** …"
   positioning block near the top. Cut throat-clearing and repetition. There is **no length
   target**: the owner's instruction is "I don't mind having more words if that means it's
   relevant. My goal is accurate and helpful documentation, not standardization." Worked
   examples and question-shaped troubleshooting entries earn their space.
5. **Screenshots** are captured centrally in a later phase from obfuscated local tenants. You do not
   run a browser. You write specs (below) describing what to capture.

## Verification protocol (this is the point of the exercise)

A claim goes in the docs only if you have seen it in code. For every substantive statement you keep,
change, or add, you must have read at least one of:

- Vue views/components under `/Users/alex/orgo/client/src/views/**`, `components/**` — labels, tabs,
  buttons, form fields, empty states, what is actually rendered and under what `v-if`.
- `/Users/alex/orgo/client/src/router.js` — which routes exist and their guards.
- `/Users/alex/orgo/client/src/config/adminSearchData.js` — the settings catalogue: every settings
  section, every toggle, and its human label. This is the fastest map of configurable behaviour.
- `/Users/alex/orgo/client/src/config/module-settings/*.js` — module feature flags.
- API Platform YAML in `/Users/alex/orgo/api/src/Resources/config/api_resources/*.yaml` — endpoints,
  operations, security expressions.
- Controllers `/Users/alex/orgo/api/src/Controller/**`, services `api/src/Service/**`,
  entities `api/src/Entity/**` — real behaviour, limits, defaults, permission checks.

Useful shortcuts: `rg` over the client for a UI label; the `codebase-memory-mcp` tools
(`search_graph`, `search_code`, `get_code_snippet`) for structural questions.

**Do not pattern-match.** "Probably works like X" is not evidence. If you cannot confirm a behaviour,
either leave it out or write the narrower statement you can support. Numbers (limits, timeouts,
page sizes, retry counts) must come from code, quoted with `file:line` in your report.

## Permissions and gating (mandatory in every page)

Where an action requires a permission, name it using the product's own vocabulary
(`ADMIN_TENANT`, `HR_TENANT`, `FINANCIAL_TENANT`, `ADMIN_LOCAL`, `HR_LOCAL`, `FINANCIAL_LOCAL`,
`ADMIN_PARENT_LOCAL`, `HR_PARENT_LOCAL`). Check `api/src/Security/CustomVoter.php` and the route
guards rather than guessing. Where a feature needs a module or setting enabled, say exactly which
one and where it lives (e.g. **Settings → Events → Online Ticket Payments**).

## Writing style

- Match the existing pages: short intro, `---` separators, `<Steps>`, `<Note>`, `<Warning>`,
  `<AccordionGroup>` for troubleshooting, tables for settings reference, "## Related" links at the end.
- Plain language. Second person ("you"), present tense. No marketing filler, no emojis.
- No em dashes or en dashes anywhere in the prose. Use commas, colons, or parentheses.
- Settings tables use the **exact UI label** as it appears in the app, bolded, plus what it does.
- Internal links use absolute doc paths, e.g. `[Permissions](/platform/permissions)`.
- Every page ends with a "## Related" section linking 3-5 sibling pages.

## Image markup convention (copy exactly)

```mdx
<img src="/images/platform/<area>/<name>.png" alt="<specific description of what is visible>" style={{ width: "100%", borderRadius: "8px", border: "1px solid var(--border-color)", marginBottom: "1rem" }} />
```

Reference images that do not exist yet **only if you also add a spec for them** (below). The capture
phase creates the files at exactly the path you referenced.

## Existing images

Your area's current images are listed in your assignment. For each, decide:
- **keep** — still shows the current UI and the page still needs it;
- **recapture** — the screen still exists but the UI changed (write a spec, same filename);
- **drop** — the screen no longer exists (remove the `<img>` from the page, note it in your report).

To judge "changed", compare the image against the current Vue view. You can `Read` a PNG to look at it.

## Screenshot spec format

Write a JSON array to your specs file. One object per image:

```json
[
  {
    "id": "events-ticket-list",
    "image": "/images/platform/events/event-tickets.png",
    "usedOn": ["platform/events/ticketing.mdx"],
    "tenant": "<slug from the tenant table below>",
    "route": "/events/edit/ticketing/123",
    "routeHint": "Events list -> open an event with ticketing enabled -> Tickets in the left sidebar",
    "actions": ["click text=Tickets"],
    "waitFor": "text=Add ticket",
    "viewport": "desktop",
    "alt": "Ticket types showing member and non-member pricing with seat limits",
    "status": "new|recapture|keep"
  }
]
```

`route` may contain a placeholder id if you do not know a real one; `routeHint` must then explain how
to reach the screen by clicking from the dashboard. `viewport` is `desktop` (1920x1080) or
`mobile` (390x844) for mobile-first surfaces. Keep specs to what the page actually needs: 2-5 images
for a typical page, more only for genuinely visual features.

## Tenants available for screenshots (local, obfuscated)

All six are already obfuscated and renamed to fictional brands, and their interface language is
forced to English. Use the slug exactly as written here.

| Slug | id | Fictional name shown in the UI | Strong in |
|---|---|---|---|
| `t187c` | 282 | Lakeside Heritage Society | contracts, courses, badges, projects/tasks, forms, drive files (262), workflows, companies, votes |
| `ila` | 182 | Nordic Food Alliance | newsletters (127), products (113), votes (27), events (210), discussions (586), contacts (643) |
| `romanian-business-leaders` | 214 | Ridgeway Business Network | companies (124), referral (510), events (222), badges, forms, votes |
| `oncr` | 1 | Northwood Scouts Association | users (27k), events (13k), units (1545), families (3367), badges (134) |
| `preper` | 87 | Civic Renewal Alliance | discussions (2186), adhesions (3248), contacts (1016), newsletters (24), gazette |
| `oceanic-global` | 228 | Blue Horizon Foundation | products (32), contacts (98), badges, contracts |

Pick whichever tenant actually has data for the screen you need. Names, emails, phones, photos and
org branding are replaced with fictional values before capture, so nothing personal is exposed.

## Your report format

```markdown
# <Area> — audit report

## Pages touched
| Page | Action | Summary |

## Deleted claims (features that do not exist)
| Page | Claim removed | Evidence (file:line) |

## New pages written
| Page | Why it was missing | Nav group + position proposed |

## Undocumented behaviour found but NOT written up
(anything you ran out of room for, or that belongs to another agent's area)

## Screenshots
counts: new / recapture / keep / dropped

## Open questions
```

## Hard rules

- **Never use the Agent/Task tool to spawn subagents of your own.** There is a hard concurrency cap
  across the whole run; a nested spawn stalls you until a watchdog kills you and your work is lost.
  Do all reading and writing yourself, with parallel Read/Grep/Bash calls in a single message when
  you need breadth.
- **Save your work incrementally.** Write each page as soon as you have verified it, and append to
  your report as you go, rather than holding everything until the end. If you are killed mid-run,
  whatever is on disk survives.
- Do not run `git commit`, `git push`, or `git checkout`. Leave changes in the working tree.
- Do not edit `docs.json`, `api-reference/**`, `changelog/**`, `RUNBOOK.md`, or another agent's pages.
- Do not modify anything under `/Users/alex/orgo` (the product repo is read-only for you).
- Do not invent screenshots: an `<img>` with no corresponding existing file and no spec is a defect.
- Report honestly. If you could not verify something, say so in "Open questions" rather than shipping
  a confident sentence.
