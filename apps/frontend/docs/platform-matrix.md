# Platform Matrix Validation

Tracks T-v0.7-08, T-v0.7-09, T-v0.7-10. Update each cell after a manual run-through. Attach screenshots / logs to a per-platform subfolder under this directory when filling a row.

## Targets

| Target | Minimum OS | Signed in | Played match | Rejoined | Notes |
|---|---|---|---|---|---|
| Chrome (desktop, latest) | — | — | — | — | — |
| Chrome (desktop, previous) | — | — | — | — | — |
| Firefox (desktop, latest) | — | — | — | — | — |
| Firefox (desktop, previous) | — | — | — | — | — |
| Safari (desktop, latest) | — | — | — | — | — |
| Safari (desktop, previous) | — | — | — | — | — |
| Mobile Safari (one evergreen) | — | — | — | — | — |
| iOS physical device | per open value | — | — | — | — |
| Android physical device | per open value | — | — | — | — |

## Run script (each cell)

1. Cold cache: clear site data + app storage.
2. Launch app; sign in with Google.
3. Tap "vs Bot"; play one full match to completion.
4. Sign in again in a second session (same userId).
5. Start a "vs Human" search; close the app mid-wait.
6. Reopen; verify the rejoin lands cleanly (`match_resume` received with seed + moves + clocks).

## Fail triage

Any `✗` opens a follow-up task in [implementation-plan.md](../../specification/implementation-plan.md) under v0.7.
