# Final pass brief

The documentation has been through a full accuracy rebuild and a screenshot audit. This is the
last read-through before it ships. The owner's instruction, verbatim:

> "do not stress over less than ideal wording or sth. It has to be good, i won't strive for
> perfect at the moment"

So: **do not rewrite prose you merely dislike.** Style opinions, tightening, rephrasing for
elegance are all out of scope. You are looking for things that would mislead a reader or
embarrass the product.

## Instance rules

Read the product code at `/Users/alex/orgo-instance-1` (branch `docs_update`, which is master).
Never touch `/Users/alex/orgo`, the `orgo-php`/`orgo-database`/`orgo-frontend` containers, or
`localhost:8095`: that is the owner's main development environment. The documentation instance
is `orgo-1-*` and `localhost:8105`. Do not spawn subagents. Do not commit or push.

## What counts as a finding

1. **Factually wrong.** A claim the code contradicts: a wrong permission, a setting that does
   not exist, a default stated backwards, a path that is not in the UI. Verify against the Vue
   components and PHP before reporting, and quote `file:line`.
2. **Prose contradicting its own screenshot.** The text promises a control, column or number
   the image beside it does not show. This is the most common defect left in the set.
3. **Real-organization content.** Any of `DAR`, `Daughters of the American Revolution`,
   `ILA`, `International Listening`, `listen.org`, `EIT`, `USSF`, `Scouting Federation`,
   `REPER`, `Cercetașii`, a real personal email, or Romanian text. The demo organization is
   **Northwind Professional Association** and its members use `@example.org`.
4. **Broken rendering.** Unbalanced MDX tags, a `<Steps>` with no `<Step>`, a table with a
   broken row, an unclosed code fence, a link to a page that does not exist.
5. **Internal contradiction.** Two pages stating opposite things, or a page contradicting
   itself between its table and its prose.
6. **An image that is blank, is the wrong screen, or shows an empty state as the subject.**
   Open the images on your pages with the Read tool. The screenshots were remediated, so most
   are fine: you are catching stragglers, not re-auditing.

## What to do

- **Fix directly** anything small and safe: a broken internal link, an alt that describes the
  wrong thing, a wrong label, a factual correction you have verified in code, an unbalanced tag.
- **Report without fixing** anything that needs a recapture, a database change, or a judgement
  call about scope. Do not recapture screenshots yourself and do not write to the database.
- No em dashes or en dashes in prose.

## Report

Write `/private/tmp/claude-501/-Users-alex-orgo-instance-1/1a6868c1-606b-4c1d-8e5c-cecdefd06316/scratchpad/docs-pass/final/<slice>.md`:

```markdown
# <slice> — final pass
Pages checked: N. Images opened: N.

## Fixed
| Page | What was wrong | What I changed |

## Needs attention (not fixed)
| Page | Problem | Why I did not fix it |

## Verdict
One paragraph: is this slice ready to ship?
```

If a slice is clean, say so plainly. A short report is a good outcome.
