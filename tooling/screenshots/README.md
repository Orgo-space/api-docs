# Documentation screenshot pipeline

Every screenshot under `images/platform/**` in this repository is generated. This directory
holds the generator: a Playwright runner, one JSON spec per image, and the validation
scripts that check the docs afterwards.

Nothing here is part of the published site. Mintlify renders only the pages listed in
`docs.json`, and this tree contains no `.mdx`.

---

## Why the screenshots are generated and not taken by hand

- There are 273 of them across 115 platform pages. Nobody is going to retake that set by hand.
- The set has to be internally consistent. Halfway through the last pass the demo organization
  got its own logo, which changed the app header in every screenshot. One clean re-run fixed it.
  A hand-taken set would have been half old logo, half new, forever.
- Screenshots must come from the obfuscated demo tenant and nowhere else. An earlier hand-picked
  image shipped a real client's member list. When the source is a spec that names its tenant,
  that class of mistake is reviewable before capture rather than discovered after publication.
- The spec is the record of what the image is supposed to show: route, permissions, the state the
  screen must be in, and the alt text. When the UI changes, you edit a spec and re-run instead of
  reconstructing what the original screenshot was even trying to demonstrate.

---

## Layout

```
tooling/screenshots/
├── README.md               this file
├── config.mjs              all machine-specific values (paths, URL, containers, credentials)
├── .gitignore              keeps session state, probes and logs out of the repo
├── capture/
│   ├── package.json        playwright dependency (npm install here)
│   ├── run.mjs             the spec runner: reads specs/, writes PNGs into images/
│   ├── login.mjs           password login per tenant, saves state-<slug>.json
│   ├── login-member.mjs    login as one named account under a chosen state slug
│   ├── make-anon-state.mjs signed-out session that already knows its tenant
│   ├── event-app-login.mjs Event App one-time-code login for attendee sessions
│   └── nw-capture.mjs      two clip-based shots run.mjs cannot express
├── specs/                  53 files, 279 specs, one object per image
├── validate.mjs            links, image references, nav coverage, frontmatter, em dashes
├── qa-images.mjs           first-pass triage for blank or near-blank captures
├── merge-nav.mjs           merges pages on disk into docs.json navigation
└── docs/                   the process briefs the whole pass was run from
```

---

## Prerequisites

1. **Node 18 or newer** and the Playwright browser binaries:

   ```bash
   cd tooling/screenshots/capture
   npm install
   npx playwright install chromium
   ```

2. **The orgo-1 documentation instance running**, with its frontend answering on
   `http://localhost:8105`:

   ```bash
   docker ps --format '{{.Names}}' | grep orgo-1
   # orgo-1-php  orgo-1-database  orgo-1-frontend  orgo-1-caddy  orgo-1-redis
   ```

3. **The demo login password**, exported as `ORGO_DOCS_PASSWORD` or written into a
   git-ignored `tooling/screenshots/.env`. It is not stored in this repository.

### The instance rule

There are two Orgo checkouts and two full sets of containers on the machine this was built on.
**All documentation work belongs to the orgo-1 instance. The unprefixed one is the owner's main
development environment: do not read from it, write to it, or capture from it.**

|  | Documentation instance (use this) | Main dev instance (do not touch) |
|---|---|---|
| Checkout | `/Users/alex/orgo-instance-1` | `/Users/alex/orgo` |
| Containers | `orgo-1-php`, `orgo-1-database`, `orgo-1-frontend` | `orgo-php`, `orgo-database`, `orgo-frontend` |
| Frontend | `http://localhost:8105` | `http://localhost:8095` |
| MySQL | port 3319 | port 3309 |

This is not a style preference. It has already gone wrong once: an obfuscation pass ran against
the owner's main development database, and their own branch switches showed up mid-capture as a
live database and a red compile-error overlay in the screenshots. Every default in `config.mjs`
points at orgo-1, and every override is an environment variable, so the wrong instance can only
be reached deliberately.

---

## The demo data

Screenshots come from one tenant only:

| | |
|---|---|
| Slug | `t187c` |
| Tenant id | 282 |
| Name shown in the UI | Northwind Professional Association |
| Member addresses | `@example.org` |

The database is **obfuscated**: member names, emails, phone numbers, addresses, dates of birth,
photos and identity records were replaced with fictional values, and the tenants were renamed to
fictional brands. The obfuscation script and the pre-obfuscation backup live in the audit archive
(see the last section), not in this repository.

The other tenants in that database (`ila`, `oncr`, `preper`, `oceanic-global`,
`romanian-business-leaders`) are clones of real organizations and are **banned as screenshot
sources**. A handful of specs still name them in history; the capture set is `t187c` plus these
pseudo-tenants, which select a session rather than an organization:

| `tenant` value | What it selects |
|---|---|
| `t187c` | Admin session on the demo tenant (`state-t187c.json`) |
| `t187c-member` | Ordinary member session, for screens whose subject is the member's own view |
| `anon` | No session at all, for signed-out pages. The route carries `?workspace=t187c` |
| `anon-t187c` | Signed out, but with the tenant already cached (see the map trap below) |
| `eventapp` | Event App attendee, logged in as a User |
| `eventappcontact` | Event App attendee, logged in as a Contact (`/event-app/my-events` rejects a User) |
| `n/a` | Not an app screen. One spec, the MCP chat window, captured outside Orgo |

### The write gate

Any script that writes to the documentation database first checks the `docs_instance_marker`
table, which exists only on the orgo-1 database:

```bash
docker exec orgo-1-php bin/console dbal:run-sql "SELECT note FROM docs_instance_marker"
# orgo-1 documentation instance: safe for obfuscation and demo seeding
```

If that returns nothing, you are pointed at the wrong database. Stop. `event-app-login.mjs`
enforces this itself and refuses to run without the marker; do the same in any seeding SQL you
write while fixing a screenshot.

---

## Configuration

Everything machine-specific resolves through `config.mjs`, in this order: environment variable,
then `tooling/screenshots/.env` (git-ignored, `KEY=VALUE` per line), then the default.

| Variable | Default | What it is |
|---|---|---|
| `ORGO_FRONTEND` | `http://localhost:8105` | The docs instance frontend. Never 8095 |
| `ORGO_DOCS_DIR` | the repo root, two levels up | Where PNGs are written and pages are validated |
| `ORGO_DOCS_PASSWORD` | none, required | Password on the local demo accounts |
| `ORGO_DOCS_ACCOUNTS` | six `slug=email` pairs | Accounts `login.mjs` signs in as |
| `ORGO_CAPTURE_CONCURRENCY` | `2` | Parallel captures. Read the concurrency trap before raising it |
| `ORGO_PHP_CONTAINER` | `orgo-1-php` | API container, used for `dbal:run-sql` and the OTP salt |
| `ORGO_DB_CONTAINER` | `orgo-1-database` | MySQL container |
| `ORGO_DB_NAME` / `ORGO_DB_USER` / `ORGO_DB_PASSWORD` | `orgo` / `orgo` / `orgopass` | Local MySQL credentials |
| `ORGO_EVENT_APP_EMAIL` | a demo attendee | Whose Event App session to create |
| `ORGO_EVENT_APP_STATE` | `state-eventapp.json` | Which state file that session lands in |
| `ORGO_EVENT_APP_CODE` | `123456` | The one-time code primed into the OTP row |
| `ORGO_MFA_SALT` | read from the container's `.env` | `MFA_CODE_HASH_SALT`, a secret, deliberately not stored here |
| `ORGO_QA_KB_PER_MP` | `12` | `qa-images.mjs` suspicion threshold |

`state-*.json` files hold live session cookies. They are git-ignored and must never be committed.
Regenerate them instead of copying them between machines.

---

## Running

### 1. Open the sessions

```bash
cd tooling/screenshots
export ORGO_DOCS_PASSWORD='...'

node capture/login.mjs t187c                                   # the admin session
node capture/login-member.mjs <member@example.org> t187c-member # member view session
node capture/make-anon-state.mjs t187c                          # signed out, tenant cached
node capture/event-app-login.mjs                                # Event App, User principal
ORGO_EVENT_APP_EMAIL=<contact@example.org> \
  ORGO_EVENT_APP_STATE=state-eventappcontact.json \
  node capture/event-app-login.mjs                              # Event App, Contact principal
```

Each prints `OK` plus the URL it landed on, and writes `capture/state-<slug>.json`. A `FAIL` with
a `/login` URL means the credentials or the account are wrong; the probe PNG beside the state file
shows what the browser saw. Sessions expire, so re-run the login before a large capture.

### 2. Capture

```bash
node capture/run.mjs                       # every spec whose status is new or recapture
node capture/run.mjs events-core           # one spec file (specs/events-core.json)
node capture/run.mjs events-core event-create-top   # one spec
node capture/nw-capture.mjs                # the two clip-based organisation shots
```

For a full pass, keep the log:

```bash
node capture/run.mjs > capture/full-recapture.log 2>&1
```

Then read the log for **all four** failure classes, not just the first:

| In the log | What it means |
|---|---|
| `FAIL` | No image was written. The reason follows the id |
| `waitFor MISSED` | An image was written, but the page never reached the state the spec asked for. Suspect |
| `ACTIONS THAT DID NOT RUN` | A click or fill failed, so the screenshot is of the page **before** it |
| `DUPLICATE IMAGES` | Two specs produced byte-identical files, so at least one shot the wrong screen |

### 3. Check the result

```bash
node qa-images.mjs        # triage only: flags captures with little rendered
node validate.mjs         # links, image references, nav coverage, frontmatter
```

Then **open the PNGs**. See the last trap.

---

## The spec format

One JSON array per area file in `specs/`. `run.mjs` reads every file in that directory, so the
filename is also the area name you pass on the command line.

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Unique within the file. The second command-line argument |
| `image` | yes | Destination path, repo-relative with a leading slash. Directories are created |
| `usedOn` | yes | The `.mdx` pages that reference this image. Keeps orphans findable |
| `tenant` | yes | Which session to load, from the table above |
| `route` | yes | Path appended to `ORGO_FRONTEND`. May carry query parameters |
| `routeHint` | no | Prose: how a human reaches this screen, what state it needs, what went wrong last time. The most valuable field in the file |
| `actions` | no | Ordered list of verbs applied after load. See below |
| `waitFor` | yes | Locator that must appear before the shot. Choose one that cannot exist until the actions have landed |
| `selector` | no | CSS selector to crop to. Without it the whole viewport is captured |
| `fullPage` | no | `true` scrolls and stitches the whole document instead of the viewport |
| `viewport` | yes | `desktop` 1920x1080, `wide` 1920x1290, `tall` 1920x2200, `mobile` 390x844 |
| `userAgent` | no | Overrides the UA. Needed for genuinely mobile rendering, see the traps |
| `alt` | yes | Alt text for the page. Describe what is actually in frame |
| `status` | yes | `new` and `recapture` are captured; `keep` and `dropped` are skipped |
| `notes` / `note` / `why` | no | Free text. Why this spec looks the way it does |

Action verbs, all matched case-insensitively as `verb argument`:

| Verb | Example | Notes |
|---|---|---|
| `click` | `click text=Tickets` | Waits 1.2s afterwards |
| `fill` | `fill input[placeholder="Search"] \| Winter Appeal` | Selector and value split on a pipe |
| `wait` | `wait 1500` | Milliseconds |
| `waitFor` | `waitFor .dropdown-content-full .checkbox-item` | 8s budget |
| `press` | `press Escape` | Playwright key names |
| `hover` | `hover text=Members` | |
| `scroll` | `scroll 600` | Wheel over the content pane, because the app scrolls an inner container |
| `scrollto` | `scrollto text=Product type` | Scrolls the element into view |

A real spec, from `specs/events-core.json`:

```json
{
  "id": "event-create-top",
  "image": "/images/platform/events/event-create.png",
  "usedOn": ["platform/events/create-event.mdx"],
  "tenant": "t187c",
  "route": "/events/create",
  "actions": [
    "fill input[required] | Autumn Governance Forum",
    "fill input[placeholder=\"Location\"] | Norfolk, Virginia, United States",
    "press Escape",
    "wait 1000"
  ],
  "waitFor": "text=Online meetup",
  "viewport": "desktop",
  "alt": "Event creation form with the title filled in, the location autocomplete resolved, and the event format cards below",
  "status": "new"
}
```

The `press Escape` is there to close the location autocomplete dropdown that the `fill` opens.
That kind of detail is the whole reason the specs are kept.

---

## Traps

These all cost someone a wrong screenshot at least once.

**A `waitFor` can match before your action has any effect.** `waitFor: "text=Add ("` matched
`Add (0)` the instant the modal rendered, so the capture fired before anything had been typed and
the panel was empty. Pick a string that cannot exist until the action has landed: `text=Add (2)`
cannot appear until both boxes are ticked. This is the single most common cause of a plausible
looking screenshot of the wrong moment.

**`exists[x]=false` means `IS NULL`, not `= 0`.** API Platform's `ExistsFilter` compiles
`exists[isLocal]=false` to `is_local IS NULL`. A row you seed with `0` to make a list look
populated will be invisible to that list, and you will be left staring at an empty table you can
prove in SQL is full. Seed `NULL`, or check what the list actually sends before seeding anything.

**Concurrency races the dev server.** At 3 parallel contexts the runner outruns the frontend and
produces skeleton-only captures. One such capture came out **within 4% of the good file's size**,
so no size threshold catches it. The default here is 2. Raising it is how you get a page of grey
placeholder bars that passes every automated check.

**`fill` splits on a pipe.** The action is `fill <selector> | <value>`. Written as
`fill input[name=x] Winter Appeal` the whole string becomes the selector and the field is filled
with an empty value, silently. The spaces around the pipe are optional; the pipe is not.

**Selector versus text.** A locator argument is treated as CSS only if it starts with `.`, `#` or
`[` (or contains ` > `, or looks like `tag[...]`). Anything else becomes a Playwright text match.
So `waitFor: "Save"` matches the text "Save", and `waitFor: "button.save"` does **not** match a
CSS class: it looks for the literal string "button.save" on the page and times out.

**An unknown verb is skipped in silence.** The verb list is fixed. Anything else is dropped without
appearing in `ACTIONS THAT DID NOT RUN`, so the screenshot is simply of the page before it. This is
why `scrolljs` does nothing today: the branch exists in the code but the verb pattern cannot reach
it. If an action seems to have no effect, first check the verb is one of the eight above.

**Dev-server error overlays intercept clicks.** A stale compile error paints a full-screen overlay.
The runner hides it with CSS on load and removes it again just before the shot, but a click issued
while it is present still times out (it does appear in `ACTIONS THAT DID NOT RUN`). If a whole
batch fails that way, fix the frontend build or restart `orgo-1-frontend` before blaming the specs.

**`mobile` viewport does not change the user agent.** The app decides mobile versus desktop
rendering from the UA (`vue-mobile-detection`), not from the width. A 390px capture without a
`userAgent` is the desktop layout squeezed into 390px. Set `userAgent` on the spec when you want
the real phone layout.

**`tall` hides the sidebar.** `AppLayout` treats `innerHeight > innerWidth` as portrait and hides
the left navigation, so `tall` (1920x2200) produces a sidebar-less shot. When a page needs more
than 1080px of height but must keep the sidebar, use `wide` (1920x1290).

**Some specs are parked at `keep` on purpose.** 18 of them. Several need setup that must not
persist: the label-override rows rename menu entries in every other screenshot from that tenant,
and the custom-dashboard flag changes the settings sidebar. Their setup and teardown SQL is written
into the spec's `routeHint`. Re-running them blind reproduces exactly the defects they were parked
to avoid. Two more (`branding-logo-grid`, `org-info-save-button`) are `keep` because their subject
spans sibling elements no CSS selector can express; `nw-capture.mjs` takes those with pixel clips.

**Verification means opening the PNG and looking at it.** Not a database query, not a file size,
not `qa-images.mjs`. A query proving the rows exist is not evidence the screenshot shows them: a
28-row seed shipped a two-row queue because the list filtered on something the seed did not
satisfy. The size heuristic has failed at least once in each direction. Use the Read tool, or open
the file. The image is the artifact; everything else is a proxy.

---

## Adding a screenshot

1. Reference the image from the page with the standard markup, using the path you are about to
   capture into:

   ```mdx
   <img src="/images/platform/<area>/<name>.png" alt="<what is visible>" style={{ width: "100%", borderRadius: "8px", border: "1px solid var(--border-color)", marginBottom: "1rem" }} />
   ```

2. Add a spec object to the matching `specs/<area>.json` with `"status": "new"`. Fill `routeHint`
   even when the route is obvious: it is what the next person reads when the capture goes wrong.
3. Reach the screen in a browser yourself first, on `localhost:8105`, signed in as the account the
   spec names. Confirm the data on it is worth photographing. An empty state is only acceptable when
   the empty state is the subject.
4. Capture just that spec: `node capture/run.mjs <area> <id>`.
5. Open the PNG. Check the subject is in frame, the data looks like an organization in use, the
   header shows the demo organization, and no cookie banner, tooltip, half-open menu or error
   overlay is in the shot.
6. Run `node validate.mjs`. A referenced image with no file on disk fails the run.

If the screen needs data that is not there, seed it through
`docker exec orgo-1-php bin/console dbal:run-sql "..."` after checking the marker, keep to
`@example.org` addresses and the Northwind naming, and write what you did into the spec's
`routeHint` so the next run reproduces it.

---

## The other scripts

`validate.mjs` walks `platform/**`, and reports internal links with no file, `<img>` references
with no file, pages missing from `docs.json`, `docs.json` entries with no file, pages with no
frontmatter title, and em dashes in body prose. Broken links, missing images, missing files and
missing titles exit non-zero; nav gaps and dashes are reported only.

`qa-images.mjs` sorts the captures from the last run by compressed size per megapixel and prints
anything under the threshold. It is a triage aid for a 270-image run, nothing more.

`merge-nav.mjs` merges pages found on disk into `docs.json` navigation using an explicit placement
table, so that concurrent authors never edit `docs.json` and conflict. It rewrites `docs.json`:
run it deliberately, and extend the table when you add a page.

---

## Where the history lives

The full audit archive from the 2026-08 accuracy pass is outside this repository, at
`/Users/alex/orgo-docs-audit-2026-08-03/`:

| Path | What it is |
|---|---|
| `PRODUCT-BUGS.md` | Product defects found while documenting, with `file:line` evidence and severity. Read this before assuming a screenshot is wrong: some of them are the product being wrong |
| `reports/` | 46 per-area audit reports: pages touched, claims deleted with evidence, undocumented behaviour, open questions |
| `audit/`, `final/` | The screenshot audit and the final read-through, per slice |
| `obfuscate.sh`, `rebrand-content.sh` | The PII obfuscation and rebranding passes |
| `orgo-backup-pre-obfuscation.sql.gz` | The local database as it was before obfuscation |
| `QUEUE.md`, `ENDGAME.md` | The per-area assignments and the closing checklist |

`docs/` in this directory holds the four briefs the pass was run from, kept because they are the
methodology rather than a log:

- [`docs/BRIEF.md`](docs/BRIEF.md): the rules every documentation agent worked to. Verification
  protocol, permission vocabulary, writing style, the spec format as it was first defined.
- [`docs/AUDIT-BRIEF.md`](docs/AUDIT-BRIEF.md): how the screenshots were audited, and the seven
  categories of defect to look for.
- [`docs/FIX-BRIEF.md`](docs/FIX-BRIEF.md): how a flagged screenshot gets fixed, what may be
  changed (demo data, specs, prose) and what may not.
- [`docs/FINAL-PASS.md`](docs/FINAL-PASS.md): what counts as a finding on a last read-through,
  and what is out of scope.

They describe a specific run, so paths and agent instructions inside them are historical. The
rules they encode are not.
