# Shell WCAG AA Contrast Audit

**Task:** T-v0.7-05  
**Standard:** WCAG 2.1 Level AA  
**Thresholds:** 4.5:1 for normal text (< 18 pt or < 14 pt bold), 3:1 for large text (≥ 18 pt or ≥ 14 pt bold)  
**Theme:** Material 3, `ColorScheme.fromSeed(seedColor: Colors.deepPurple)`  
**Tested:** Light theme only (dark theme not yet shipped)

---

## Color palette (computed values)

| Token | Hex |
|---|---|
| `surface` | `#FEF7FF` |
| `onSurface` | `#1D1B20` |
| `onSurfaceVariant` | `#49454E` |
| `primary` | `#68548E` |
| `onPrimary` | `#FFFFFF` |
| `secondary` | `#635B70` |
| `onSecondary` | `#FFFFFF` |
| `error` | `#BA1A1A` |
| `onError` | `#FFFFFF` |
| `primaryContainer` | `#EBDDFF` |
| `onPrimaryContainer` | `#4F3D74` |
| `surfaceContainerLow` | `#F8F1FA` |
| `surfaceContainer` | `#F2ECF4` |
| `surfaceContainerHighest` | `#E7E0E8` |

---

## Per-screen audit

### SignInScreen (`/sign-in`)

| Element | Foreground | Background | Ratio | AA Normal | AA Large |
|---|---|---|---|---|---|
| Page body text (`bodyMedium` — "Sign in to play") | `onSurfaceVariant` `#49454E` | `surface` `#FEF7FF` | **8.89:1** | PASS | PASS |
| App title (`headlineMedium` bold) | `onSurface` `#1D1B20` | `surface` `#FEF7FF` | **16.23:1** | PASS | PASS |
| Apple button label (white on black) | `#FFFFFF` | `#000000` | **21.00:1** | PASS | PASS |
| Google button label (black87 on white) | `#DD000000` | `#FFFFFF` | **21.00:1** | PASS | PASS |
| Privacy / Terms link text (`TextButton`) | `primary` `#68548E` | `surface` `#FEF7FF` | **6.47:1** | PASS | PASS |

**Result: PASS**

---

### HomeScreen (`/home`)

| Element | Foreground | Background | Ratio | AA Normal | AA Large |
|---|---|---|---|---|---|
| App bar title (`titleLarge`) | `onSurface` `#1D1B20` | `surface` `#FEF7FF` | **16.23:1** | PASS | PASS |
| Profile display name (`titleMedium` bold) | `onSurface` `#1D1B20` | `surface` `#FEF7FF` | **16.23:1** | PASS | PASS |
| "Ready to play" subtitle (`bodySmall`) | `onSurfaceVariant` `#49454E` | `surface` `#FEF7FF` | **8.89:1** | PASS | PASS |
| "Choose a mode" heading (`titleLarge` w600) | `onSurface` `#1D1B20` | `surface` `#FEF7FF` | **16.23:1** | PASS | PASS |
| Mode card title (`titleMedium` w600) | `onSurface` `#1D1B20` | `surfaceContainerLow` `#F8F1FA` | **15.41:1** | PASS | PASS |
| Mode card subtitle (`bodySmall`) | `onSurfaceVariant` `#49454E` | `surfaceContainerLow` `#F8F1FA` | **8.44:1** | PASS | PASS |
| Mode icon | `primary` `#68548E` | `surfaceContainerLow` `#F8F1FA` | **5.84:1** | PASS | PASS |
| Avatar initial letter (`titleLarge`) | `onPrimaryContainer` `#4F3D74` | `primaryContainer` `#EBDDFF` | **7.25:1** | PASS | PASS |

**Result: PASS**

---

### AccountScreen (`/account`)

| Element | Foreground | Background | Ratio | AA Normal | AA Large |
|---|---|---|---|---|---|
| Display name (`titleMedium` w600) | `onSurface` `#1D1B20` | `surfaceContainerLow` `#F8F1FA` | **15.41:1** | PASS | PASS |
| User ID (`bodySmall`) | `onSurfaceVariant` `#49454E` | `surfaceContainerLow` `#F8F1FA` | **8.44:1** | PASS | PASS |
| "Danger Zone" label (`labelLarge`) | `error` `#BA1A1A` | `surface` `#FEF7FF` | **6.14:1** | PASS | PASS |
| Delete Account button text (`labelLarge`) | `error` `#BA1A1A` | `surface` `#FEF7FF` | **6.14:1** | PASS | PASS |
| Warning text (`bodySmall`) | `onSurfaceVariant` `#49454E` | `surface` `#FEF7FF` | **8.89:1** | PASS | PASS |
| Avatar initial letter (`headlineSmall`) | `onPrimaryContainer` `#4F3D74` | `primaryContainer` `#EBDDFF` | **7.25:1** | PASS | PASS |

**Result: PASS**

---

### MatchScreen (`/match`)

| Element | Foreground | Background | Ratio | AA Normal | AA Large |
|---|---|---|---|---|---|
| App bar "Match" title | `onSurface` `#1D1B20` | `surface` `#FEF7FF` | **16.23:1** | PASS | PASS |
| Leave match icon button | `onSurface` `#1D1B20` | `surface` `#FEF7FF` | **16.23:1** | PASS | PASS |

Note: the game view body is rendered by the embedded Phaser client and is out of scope for this audit.

**Result: PASS**

---

### ResultScreen (`/result`)

| Element | Foreground | Background | Ratio | AA Normal | AA Large |
|---|---|---|---|---|---|
| WIN label (`displaySmall` bold) — updated | `#2E7D32` (green.shade800) | `surface` `#FEF7FF` | **4.87:1** | PASS | PASS |
| LOSE label (`displaySmall` bold) | `error` `#BA1A1A` | `surface` `#FEF7FF` | **6.14:1** | PASS | PASS |
| DRAW label (`displaySmall` bold) | `secondary` `#635B70` | `surface` `#FEF7FF` | **6.44:1** | PASS | PASS |
| "Your score" / "Opponent score" (`bodyLarge`) | `onSurface` `#1D1B20` | `surfaceContainer` `#F2ECF4` | **14.70:1** | PASS | PASS |
| Score numbers (`titleLarge` bold) | `onSurface` `#1D1B20` | `surfaceContainer` `#F2ECF4` | **14.70:1** | PASS | PASS |
| Play Again button text | `onPrimary` `#FFFFFF` | `primary` `#68548E` | **6.47:1** | PASS | PASS |

**Palette change:** The WIN label was changed from `Colors.green.shade600` (#43A047, 3.14:1) to `Colors.green.shade800` (#2E7D32, 4.87:1). The `displaySmall` style is large text (36 sp) so shade600 technically passed AA-large (3.14 > 3.0), but shade800 clears the stricter AA-normal threshold (4.5:1) giving a clean pass across all text sizes.

**Result: PASS**

---

### PrivacyScreen (`/legal/privacy`) and TermsScreen (`/legal/terms`)

Both screens render Markdown via `flutter_markdown`. The package uses the ambient `ThemeData` text styles. All rendered text uses `onSurface` (#1D1B20) on `surface` (#FEF7FF) — ratio 16.23:1.

| Element | Foreground | Background | Ratio | AA Normal | AA Large |
|---|---|---|---|---|---|
| Markdown body text | `onSurface` `#1D1B20` | `surface` `#FEF7FF` | **16.23:1** | PASS | PASS |
| Markdown headings (`h1`–`h3`) | `onSurface` `#1D1B20` | `surface` `#FEF7FF` | **16.23:1** | PASS | PASS |

**Result: PASS**

---

## Summary

| Screen | AA Normal | AA Large | Notes |
|---|---|---|---|
| SignInScreen | PASS | PASS | — |
| HomeScreen | PASS | PASS | — |
| AccountScreen | PASS | PASS | — |
| MatchScreen | PASS | PASS | Game view body out of scope |
| ResultScreen | PASS | PASS | WIN label updated: green.shade600 → green.shade800 |
| PrivacyScreen | PASS | PASS | — |
| TermsScreen | PASS | PASS | — |

All shell screens pass WCAG 2.1 Level AA.
