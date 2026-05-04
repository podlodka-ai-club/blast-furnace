# Original Task

## Issue Title

[Feature] Capitalize the first letter of Category name

## Goal

Make category names consistent by ensuring the first letter is capitalized when a user submits a category name.

## Expected Behavior

When a user enters a category name such as `scientific books` and submits it, the saved and displayed category name should become `Scientific books`.

An already capitalized value such as `Engineering books` should remain consistently capitalized.

## Acceptance Criteria

- A newly created category with a lowercase first letter is saved with the first letter capitalized.
- Category rename submission follows the same capitalization rule.
- Capitalization happens on submission, not while the user is typing.
- Existing duplicate-name handling continues to apply after normalization.
- Tests cover the category-name normalization behavior.

## Relevant Constraints

- Only the first character of the submitted, trimmed category name should be uppercased.
- The rest of the category name should be left unchanged.
- Empty category names should still be rejected by the existing behavior.
- The original GitHub issue is private; links and repository identifiers are intentionally omitted.

