# App Store + Play Console Review Checklist

Covers v0.6 / v1.0 submissions. Items marked **required** must be green before submitting; items marked **check** are self-audit for common rejection causes.

## Apple App Store

### Guideline 4.2 — Minimum functionality / beyond a web wrapper

- [ ] **required** Flutter shell runs fully native UI for: sign-in, home, account, legal pages, result screen.
- [ ] **required** Game view is embedded in WKWebView (native container) — not a browser tab.
- [ ] **check** Screenshots show native shell UI, not just the WebView content.
- [ ] **check** The app offers features beyond a web-only experience: native auth, offline-ready shell, lifecycle-aware pause/resume.

### Guideline 4.8 — Sign-In

- [ ] **required** Sign-In with Apple is offered alongside Google Sign-In (both prominent, equal visual weight).
- [ ] **required** Sign-in does not collect more than name + email; we collect display name + avatar URL only.
- [ ] **check** Apple Sign-In button follows Apple HIG (black/white, system font).

### Guideline 5.1.1(v) — Account deletion

- [ ] **required** In-app account deletion reachable in ≤ 3 taps from home (home → account → delete).
- [ ] **required** Deletion flow: two-step confirmation; destructive-colour cue; copy states "this is permanent".
- [ ] **required** Deletion actually deletes users row and anonymises match history (see [T-v0.6-F02](../../specification/implementation-plan.md)).
- [ ] **required** Deleted user cannot sign in again with the same credentials without re-creating an account (Firebase user revoked).

### Privacy

- [ ] **required** Privacy policy URL (T-v0.6-H06) publicly reachable, accurate about data collected.
- [ ] **required** Privacy Nutrition Label filled in App Store Connect (auth data + usage data).
- [ ] **check** No IDFA collection unless later justified.

### App Store Connect build metadata

- [ ] **required** TestFlight internal build uploaded (T-v0.6-H10).
- [ ] **required** Privacy URL, ToS URL, support URL populated.
- [ ] **check** Screenshots sized for all required device classes.

## Google Play Console

### Policy — Account deletion

- [ ] **required** In-app deletion UI reachable (same as Apple 5.1.1(v)).
- [ ] **required** Web URL for deletion request per Play Console deletion policy — even if it just links back to the app.

### Data safety form

- [ ] **required** Declares: display name (collected, required, account function), email (if collected), avatar URL.
- [ ] **required** Declares data NOT shared with third parties (Firebase is the processor, not a third-party sharer).

### Closed-track submission

- [ ] **required** Closed-track internal build uploaded (T-v0.6-H11).
- [ ] **required** At least two internal testers added.

## Pre-submission smoke (both stores)

On a physical device at each store's minimum OS:

- [ ] Sign in with Apple succeeds (iOS).
- [ ] Sign in with Google succeeds (both).
- [ ] Match vs bot completes; result screen shows WIN/LOSE/DRAW.
- [ ] Sign out + sign in again; previous match history visible.
- [ ] Account deletion completes; signing in again produces a fresh account.
- [ ] Cold load → in-match ≤ 20 s (NFR-12a).
- [ ] Returning load → in-match ≤ 10 s (NFR-12b).

## Artefact links

Fill in as each H-task lands.

| Task | Artefact |
|---|---|
| H01 Apple enrolment | TBD |
| H02 Google enrolment | TBD |
| H03 Apple provisioning | TBD |
| H04 Android keystore | TBD |
| H05 Icons + launch screens | TBD |
| H06 Privacy / ToS URLs | TBD |
| H07 4.8 self-review | this file |
| H08 4.2 self-review | this file |
| H09 5.1.1(v) self-review | this file |
| H10 TestFlight build | TBD |
| H11 Play closed-track build | TBD |
