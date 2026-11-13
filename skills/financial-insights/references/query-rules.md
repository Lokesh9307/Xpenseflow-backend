# Financial query rules

- Filter by authenticated user ID at the database query boundary.
- Resolve periods to exact inclusive/exclusive date bounds.
- Use deterministic code for sums, percentages, and comparisons.
- State filters, period, and any query limit in the answer.
- Query failures must remain failures; do not produce success-shaped empty totals.
