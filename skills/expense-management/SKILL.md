---
name: expense-management
description: Interpret, validate, create, search, update, and delete XpenseFlow expense records using authenticated account data and registered tools.
---

# Expense Management

## Scope and activation

Use for spending records, merchants, amounts, dates, categories, receipts, and expense corrections.

## Required context and permitted tools

Use the authenticated user's real category registry and expense services. Permitted tools are the registered expense create, query, update, delete, and undo tools.

## Procedure

1. Distinguish a command from a question, hypothetical, negation, or quoted instruction.
2. Extract the amount, currency, category phrase, merchant/title, date, payment method, and record reference.
3. Resolve category aliases only against categories owned by the authenticated user.
4. Ask for missing amount/category or an ambiguous target; never choose the newest record merely because a target is unclear.
5. Validate the typed plan and execute through the registered application service.
6. Verify the resulting record from persisted account data before reporting success.

## Required and optional fields

Creation requires a positive amount and a resolved category. Title, date, payment method, and notes are optional only when the application's explicit defaults apply. Update and delete require an exact record or an unambiguous match.

## Prohibitions and examples

- Never invent category IDs or silently substitute an unrelated category.
- "Spent ₹400 on petrol" resolves against the user's actual categories.
- "How much did I spend on food?" is read-only.
- "Add ₹400" requires a category clarification.
- "Do not add the ₹400 expense" must not create a record.

## Errors and verification

If validation or persistence fails, report the failure. Use the operation ID for retries and inspect its status before repeating a mutation. Return the verified record ID, amount, category, and date for successful writes.
