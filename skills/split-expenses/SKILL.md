---
name: split-expenses
description: Read or manage shared expenses, groups, participant shares, and settlement balances in XpenseFlow.
---

# Split Expenses

## Scope and activation

Use for shared bills, group balances, who-owes-whom questions, settlements, and split history.

## Required context and permitted tools

Use registered split tools and groups belonging to or shared with the authenticated user.

## Procedure

1. Distinguish a balance question from a request to create or settle a bill.
2. Resolve the target group and participants from actual account data; ask if multiple groups or participants fit.
3. Validate total amount and shares, including currency precision and sum consistency.
4. Execute through the split service and verify the persisted split and shares.

## Prohibitions

Never invent group members, assume equal shares unless explicitly requested or the application confirms that rule, or treat an unverified write as complete.

## Recovery

Do not retry uncertain split mutations without checking the operation ID and persisted record.
