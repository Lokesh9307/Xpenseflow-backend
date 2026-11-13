---
name: tiffin-management
description: Read and manage Tiffin meals, group rates, member participation, and Tiffin-to-expense synchronization.
---

# Tiffin Management

## Scope and activation

Use for meal logging, Tiffin history, member bills, meal rates, and Tiffin-linked Expense Tracker data.

## Required context and permitted tools

Use authenticated Tiffin group and entry services. Each group entry's saved bill/memberBills is authoritative for that meal; do not substitute a current group price for a historical entry with a recorded total.

## Procedure

1. Resolve the group, meal type, date, quantity, participating members, extras, and price from the request and actual group data.
2. Ask for clarification if multiple groups, dates, or participant sets are plausible.
3. Validate that the user's account is permitted to access the target group.
4. Execute the registered Tiffin operation and verify the persisted entry.
5. When showing synced expense values, match canonical rows by Tiffin entry and group IDs; use title/date only for a unique legacy match.

## Prohibitions

Never recalculate a historical bill using today's group rate when a saved price, member bill, or recorded total is available. Never merge separate groups because their names match.

## Verification

Report the persisted meal entry and member share. Explain a failed sync separately from a successfully saved meal.
