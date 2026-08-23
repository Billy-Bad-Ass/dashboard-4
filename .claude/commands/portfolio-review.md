---
description: Run the weekly portfolio review — read every project, verify the findings, produce one action
---

Run the `portfolio-review` workflow with the Workflow tool.

It reads the live dashboard API rather than the repository, so `DASHBOARD_URL`
must be set. Findings are adversarially verified before they are ranked; a claim
that cannot be confirmed against a real number does not reach the report.

Output lands in `docs/reports/portfolio-<date>.md`.
