# Category resolution reference

- Resolve exact category names first, case-insensitively.
- Resolve aliases only to categories actually owned by the authenticated user.
- An unknown or conflicting alias requires clarification; do not create a category as a side effect of an expense.
- Keep a merchant/title separate from a category unless the user explicitly uses it as the category.
- Preserve the application's explicit category ID in prepared and persisted actions.
