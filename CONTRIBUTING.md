# Contributing

Small, testable changes are welcome.

Before submitting a change:

1. Keep secrets and real conversations out of commits and issues.
2. Add or update a test for changes to safety routing.
3. Run `npm test`, `npm run check`, and then `npm run verify:clean`.
4. If clean-tree verification reports drift, commit the canonical generated output or make the responsible step read-only; do not ignore or weaken the guard.
5. Describe user impact, safety tradeoffs, privacy impact, and rollback behavior.
6. Mark changed files as required by the repository license.

Changes that weaken urgent routing, add prompt logging, make clinical claims, or optimize engagement at the expense of user agency need explicit safety and privacy review.
