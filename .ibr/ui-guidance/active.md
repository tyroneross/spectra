# Active Visual Register: Aurora Glass

**Decision date:** 2026-05-24
**Re-skin run:** `feat/ui-reskin-aurora-glass`
**Source template:** `~/dev/git-folder/UI Guidance/aurora-glass.md`

## Why Aurora Glass

Spectra is a macOS menu-bar utility plus a companion web dashboard. The user reaches for it **between** coding sessions in Claude Code / Codex — it's adjacent to the workflow, not the workflow itself. Aurora Glass's own guidance is explicit about this fit:

> "Use Aurora Glass when the interface is one of many tools the user switches between — it should feel refined but not immersive."

This positions Aurora Glass against its sibling Aurora Deep ("primary workspace… a place to inhabit"). Spectra is a sidekick, not a workspace. Two concrete consequences:

1. **No animated background.** The Aurora Deep drift animation taxes always-on menu-bar GPU. Aurora Glass uses a static ambient gradient — perceptible but never moves, which is the right ergonomics for a popover that snaps open and shut hundreds of times a day.
2. **Cleaner nav, smaller surface flourish.** Aurora Glass omits the stats bar, the dot indicators, and the branded sidebar mark. That maps cleanly onto Spectra's tab-bar navigation in `web-ui/components/nav.tsx` (Captures · Sessions · Export · Guidance · Archive) and the dense compact popover layout in `MenuBarPopover.swift`.

## Why not Warm Craft

Warm Craft is for "tools where 'I enjoy using this' is a product requirement" — personal productivity, writing environments, knowledge management. Spectra is closer to a system tool. Warm Craft's "campfire / forest / clay" semantics would feel costumed on a capture utility used inside CI-shaped workflows.

## Why not Aurora Deep

Aurora Deep is positioned for "the user's primary workspace." Spectra is not where the user spends hours; it's where they grab artifacts between bursts of real work. The Aurora Deep ambient animation + branded sidebar + stats-bar metric cards would over-dress a utility and pay perceptible always-on GPU cost on the macOS menu bar.

## Continuity with sibling apps

None of the user's sibling apps (`atomize-ai`, `decision-doctor`, `travel-planner`) currently use the Aurora family — atomize-ai is a light-theme product (`oklch(1 0 0)` background); decision-doctor and travel-planner ship without a dark-glass register. Spectra adopting Aurora Glass establishes the family's first reference implementation. The token names (`--bg`, `--surface`, `--glass`, `--accent`, `--accent-glow`) are stable across registers in the library, so a future sibling can adopt Aurora Glass by copying the variable block.

## Token bindings adopted

### Background palette
| Aurora Glass token | Hex | Maps to |
|---|---|---|
| `--bg` | `#09090b` | macOS: window background (system-tinted); web: `body { background-color }` already matches |
| `--surface` | `rgba(255,255,255,0.03)` | macOS: `SpectraSurface.subtle`; web: card fills |
| `--surface-hover` | `rgba(255,255,255,0.06)` | Card/row hover |
| `--glass` | `rgba(255,255,255,0.04)` | Inputs, dropdowns |
| `--glass-border` | `rgba(255,255,255,0.08)` | Default borders |

### Text
| Token | Hex | Maps to |
|---|---|---|
| `--primary` | `#fafafa` (zinc-50) | Titles, primary content |
| `--secondary` | `#a1a1aa` (zinc-400) | Body, descriptions |
| `--muted` | `#52525b` (zinc-600) | Metadata, placeholders |

### Accent
| Token | Hex | Role |
|---|---|---|
| `--accent` | `#818cf8` | Primary CTA, focus, active nav |
| `--accent-glow` | `rgba(129,140,248,0.15)` | Active nav background, focus rings |
| `--success` | `#34d399` | Connected, GitHub-source, ready states |
| `--warning` | `#fbbf24` | Helper-offline, caution |
| `--danger` | `#fb7185` | Errors, destructive |

### Ambient
Static (no animation) radial-gradient on `body::before` for web. macOS keeps its native system materials — no synthetic gradient on the menu-bar popover (popover GPU cost + macOS HIG: respect window vibrancy).

## Scope of this re-skin

**Touched:**
- `macos/Spectra/Views/DesignTokens.swift` — token values swapped to Aurora Glass palette
- `macos/Spectra/Views/ActionButtonStyle.swift` — primary CTA picks up `--accent` glow on enabled; standard button picks up `--glass-border`
- `web-ui/app/globals.css` — CSS custom properties rebound; `body::before` ambient gradient added; nav-active and focus-ring utilities added
- `web-ui/components/nav.tsx` — active-tab indicator swapped from bottom-border to accent-glow pill (matches Aurora Glass §"Sidebar" pattern)
- `docs/UX_JOURNEYS.md` + `docs/WEB_UX_JOURNEYS.md` — appended "Visual register" section per acceptance criterion 6

**Not touched:**
- View structure, layout, journey-flow
- A11y labels, hints, semantic roles
- Empty / error / loading state placement
- Business logic, MCP tools, daemon, tests
- The host-routed plugin work (H1–H5)
