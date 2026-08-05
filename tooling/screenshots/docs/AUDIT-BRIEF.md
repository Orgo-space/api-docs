# Screenshot audit brief

The owner reviewed the documentation and found screenshots that should never have shipped:
an empty page, a queue with two rows, screens from an unmerged feature branch, and one list
full of a real client's data (`EIT Food`, `ILA Convention`, real personal emails). His
instruction: **go through each and every screenshot and analyse it carefully.**

You are auditing one slice. **Open every image in your slice with the Read tool and look at
it.** A file that exists is not evidence that it is usable.

## Do not

- Do NOT spawn subagents. A previous run died that way and lost its work.
- Do NOT edit `.mdx` pages, `docs.json`, or any image. **Report only.**
- Do NOT run captures or touch the database.
- Do NOT use the `orgo-php`, `orgo-database` or `orgo-frontend` containers, `localhost:8095`,
  or the `/Users/alex/orgo` checkout. Those are the owner's main development environment.
  The documentation instance is `orgo-1-*`, `localhost:8105`, `/Users/alex/orgo-instance-1`.

## What to check, per image

For each image, find the page that uses it
(`grep -rn "<filename>" /Users/alex/api-docs/platform/`) and read the surrounding prose and
its `alt` text. Then judge:

1. **Blank or near-blank.** Sidebar with an empty content pane, a bare header, a skeleton
   loader still showing. Anything where the subject of the screenshot is not visible.
2. **Wrong screen.** The image does not show what the prose and the alt text claim. This
   happens when a spec's click action silently failed and the shot is of the page before it.
3. **Empty or thin data.** A list with one or two rows, all-zero counters, "No X yet" empty
   states, a chart with no line. The product should look like an organization in use.
4. **Real identity or test data.** Any of: `ILA`, `International Listening`, `listen.org`,
   `EIT Food`, `DAR`, `virginiadar`, `Daughters of the American Revolution`, real-looking
   personal emails (gmail, yahoo, .edu, .gov), `test`, `testtttt`, `asdf`, `lorem`, or
   Romanian text. The demo organization is **Northwind Professional Association**; members
   have `@example.org` addresses. Anything else is a leak and is the highest severity.
5. **Stale interface.** Compare against the current components in
   `/Users/alex/orgo-instance-1/client/src/views/**`. Report a screenshot whose layout,
   labels or buttons no longer match the code.
6. **Repetition.** The same image used more than once on a single page, or two images on one
   page that show effectively the same screen.
7. **Cosmetics.** A red webpack "Compiled with problems" overlay, a cookie banner, a
   half-open menu, an unintended tooltip, an obviously broken image glyph.

## Report

Write `/private/tmp/claude-501/-Users-alex-orgo-instance-1/1a6868c1-606b-4c1d-8e5c-cecdefd06316/scratchpad/docs-pass/audit/<slice>.md`:

```markdown
# <slice> — screenshot audit
Checked: N images

## Problems
| Image | Used on | Category | What is wrong | Suggested fix |
|---|---|---|---|---|

## Clean
<filenames, one line, no commentary>
```

Categories: `blank`, `wrong-screen`, `thin-data`, `identity-leak`, `stale-ui`, `repetition`,
`cosmetic`. Order the table by severity: identity-leak first, then blank and wrong-screen,
then the rest.

Be specific in "What is wrong": name what you can see in the image. "Looks sparse" is not a
finding; "the table has two rows, both dated February, and the Payer and Chapter columns are
empty" is. If an image is fine, say so and move on: a clean bill of health for 30 images is a
perfectly good report.

Every spec lives in
`/private/tmp/claude-501/-Users-alex-orgo-instance-1/1a6868c1-606b-4c1d-8e5c-cecdefd06316/scratchpad/docs-pass/specs/*.json`,
keyed by its `image` path. Quote the spec `id` in your Suggested fix when a recapture is needed.
