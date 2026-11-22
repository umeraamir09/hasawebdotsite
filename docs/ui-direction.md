# UI direction

The visual reference is the [hasaweb.site Direction A Figma file](https://www.figma.com/design/rjvDSCHPajF3Lpe8qNxX5U/hasaweb.site---Direction-A---SIDE-B?node-id=392-2). Use it for layout, typography, color, spacing and component appearance. [product.md](product.md) controls scope and [acceptance-criteria.md](acceptance-criteria.md) controls behavior.

## Useful nodes

File key `rjvDSCHPajF3Lpe8qNxX5U`. The editor and the setup guide follow page "Editor / Workbench" (`392:2`) and the "Setup v2" sections of page "Onboarding / A little space to begin" (`325:2`). The hidden older frames on `325:2` are not the target. Do not use page "Editor / Made for your work" (`192:694`) or the older `A /` and `Hero /` styles.

| Node | What |
| --- | --- |
| `392:2` | Editor / Workbench page: the Workbench variables (Light and Dark), Geist text styles and every editor frame |
| `393:2` | Icon set |
| `394:2` | Components board: Button, IconButton, Toggle, Field, Area, SectionRow, RailItem, StatusPill, Chip |
| `406:1147` | Editor shell: top bar, rail, panel and canvas |
| `404:226` | Portfolio kit used inside editor previews |
| `325:2` | Onboarding page; the setup guide is its Setup v2 sections |
| `471:11455` | Setup v2 kit |
| `330:252`, `330:271`, `330:533` | Avatar, banner and mobile crop dialogs |
| `330:371` | Public email confirmation |

Portfolio previews must stay true to the owner's design on page "Portfolio / Source" (`4:78`). Portfolio themes and their Figma boards are listed in [appearance-catalog.md](appearance-catalog.md).

## Workbench foundations

The app uses Geist and Geist Mono with a neutral palette and the signal blue (`#3557ff` light, `#7188ff` dark) for focus, selection and switches. Published portfolios keep their catalog fonts and themes.

The shared controls are in `apps/web/components/workbench`: Button, IconButton, Toggle, Field, Area, Chip, FilterChip, StatusPill, SectionRow, SegmentedControl, Popover and Dialog, plus the icon set. `/catalog/workbench` shows each control in both schemes. Controls show real state and results and carry no helper text the design does not show.

- **Tokens.** `workbench.css` defines the Workbench collection as `--wb-*` custom properties (`bg/panel` is `--wb-bg-panel`). They follow the operating system's color scheme, and `data-wb-scheme="light"` or `"dark"` pins one. A screen opts in with `class="workbench"`. `figma-tokens.json` records the Figma values; `workbench.test.ts` checks the CSS against them and lists the five values changed to reach WCAG 2.2 AA (`text/tertiary` in both schemes, and the light `success/base`, `warning/base` and `danger/base`). `--wb-line-control` is not in Figma: it is the 3:1 boundary for an off toggle and a selected segment.
- **Fonts.** The unmodified variable TTFs and their SIL OFL notices are in `apps/web/fonts/`, from Google's font repository at a pinned commit. `fonts.json` records each source and SHA-256 digest, and the test checks the bytes. Next.js serves content-hashed copies; there are no third-party font requests.
- **Contrast and focus.** Text pairs reach 4.5:1 and control boundaries, state indicators and the focus ring reach 3:1 in both schemes; the test lists each pair. Every control shows a 2 px signal focus ring, and fields show a 1.5 px signal border while focused.
- **Keyboard.** Toggle, Chip, FilterChip and SectionRow are native buttons. SegmentedControl is a radio group: Tab reaches the selected segment, and arrow keys, Home and End select another. Popover moves focus inside when it opens and closes on Escape (returning focus to its trigger), an outside click or focus leaving it. Dialog is a centered modal above 640 px and a bottom sheet at 640 px and below; it traps Tab, closes on Escape, the close button or the scrim, and returns focus to where it was. `controls.test.tsx` covers this behavior.

The editor and the setup guide still use the earlier DM Sans and lime styling until phases 51.2 to 51.5 move each screen onto these controls.

## Initial setup

See [onboarding.md](onboarding.md) for the guide's behavior. The Profile step shows avatar and banner previews and uses the shared crop dialogs (reposition, zoom, Reset, Apply crop, Cancel). Optional Skip actions appear only after required setup. Review uses the real shared renderer with desktop/mobile switching.

## Figma access

Use the connected Figma MCP to read design context, screenshots and assets. If it is unavailable or cannot open the file, say so and ask the user to connect it. Never claim to have inspected a design you could not open.

**The file is read-only.** Do not create, edit or delete anything in it unless the user asks for that change. If a change seems necessary, explain what and why and ask first. MCP access does not authorize writes.
