---
name: financial-insights
description: Answer questions about spending, income, budgets, trends, comparisons, and financial summaries using deterministic account queries.
---

# Financial Insights

## Scope and activation

Use for totals, spending by category, trends, budget status, comparisons, and financial summaries.

## Required context and permitted tools

Use authenticated, read-only query tools and the user's actual currency and categories.

## Procedure

1. Resolve the requested period from explicit dates or supported relative periods.
2. Ask when the requested period or comparison is materially unclear.
3. Query account data with a bounded scope and calculate totals in application code.
4. Explain the period and filters used; distinguish totals from estimates.

## Prohibitions

Never make up balances or derive financial facts from model memory. Do not mutate records in response to a read-only question. Do not describe a partial/limited query as a complete lifetime total.

## Verification

Use returned query results as the source of truth. If the query fails or is capped, disclose the limitation rather than filling gaps.
