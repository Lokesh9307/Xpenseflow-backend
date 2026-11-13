---
name: app-navigation
description: Resolve requests to open screens or explain where XpenseFlow features are located.
---

# App Navigation

## Scope and activation

Use for "open", "show", "go to", "where is", and other app-screen requests.

## Required context and permitted tools

Use only the backend's registered navigation routes and aliases.

## Procedure

1. Determine whether the user asks to navigate or only asks where a feature is.
2. Resolve the request to a registered screen ID.
3. If no unique screen matches, ask a short clarification or show registered destinations.
4. Return the canonical navigation action; never fabricate a route.

## Prohibitions

Opening Profile or Settings must not trigger logout or another account mutation.
