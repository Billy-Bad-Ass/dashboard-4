---
description: Audit the spend ledger against what is actually being paid for
---

Use the `spend-auditor` subagent.

Read the ledger from `$DASHBOARD_URL/api/spend` and cross-check it against what
the repositories actually depend on. Propose fixes as an issue; never edit the
ledger — it is a financial record and a human confirms every change.
