# Tiffin rules

- A Tiffin entry is identified by its persisted entry ID and group ID.
- Prefer explicit saved memberBills; otherwise derive from the entry's saved unit price and participation/quantity fields.
- For legacy entries with a saved total but no unit-price snapshot, derive the missing unit price from the recorded total and recorded quantity.
- Current group rates apply to new entries only; changing a group rate must not change historical expense values.
- Legacy title/date matching is acceptable only when exactly one entry matches.
