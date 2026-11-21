# demo fixtures

Two tiny static sites used by the end-to-end test and `npm run demo`.

- `before/` — clean home page and pricing page (labelled buttons, alt text, ordered headings,
  no console output).
- `after/` — the same app after an "agent PR": new hero copy and colour, an icon-only button,
  a screenshot without `alt`, a section whose heading skips from h1 to h3, and a 500 error
  logged to the console. `pricing/` is unchanged on purpose, so the report shows a green row.

```bash
node dist/bin/cli.js compare --base demo/before --head demo/after --routes /,/pricing --out proofshot-out
```

Expected: `/` is reported changed with four new a11y issues and one console error; `/pricing`
is 0% with no a11y delta.
