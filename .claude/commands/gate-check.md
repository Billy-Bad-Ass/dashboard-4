---
description: Work out what is actually blocking a project's first pound
argument-hint: <project-slug>
---

Run the `gate-check` workflow with the Workflow tool, passing `{ slug: "$1" }`.

It checks each gate in `config/portfolio.ts` against the repository rather than
against the written description, because the two drift. Returns the gates ranked
by what unblocks the most, and one concrete first action.
