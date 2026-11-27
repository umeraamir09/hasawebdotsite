# UI direction

The visual reference is the [hasaweb.site Direction A Figma file](https://www.figma.com/design/rjvDSCHPajF3Lpe8qNxX5U/hasaweb.site---Direction-A---SIDE-B?node-id=392-2). Use it for layout, typography, color, spacing and component appearance. [product.md](product.md) controls scope and [acceptance-criteria.md](acceptance-criteria.md) controls behavior.

## Useful nodes

File key `rjvDSCHPajF3Lpe8qNxX5U`. The editor and the setup guide follow page "Editor / Workbench" (`392:2`) and the "Setup v2" sections of page "Onboarding / A little space to begin" (`325:2`). The setup guide wears the look of page "Marketing / Pixel town landing" (`553:2`). The hidden older frames on `325:2` are not the target. Do not use page "Editor / Made for your work" (`192:694`) or the older `A /` and `Hero /` styles.

| Node | What |
| --- | --- |
| `392:2` | Editor / Workbench page: the Workbench variables (Light and Dark), Geist text styles and every editor frame |
| `393:2` | Icon set |
| `394:2` | Components board: Button, IconButton, Toggle, Field, Area, SectionRow, RailItem, StatusPill, Chip |
| `406:1147` | Editor shell: top bar, rail, panel and canvas |
| `404:226` | Portfolio kit used inside editor previews |
| `325:2` | Onboarding page; the setup guide is its Setup v2 sections |
| `553:2` | Pixel town landing: Host Grotesk, ink outlines with stepped corners, lime selection and pixel sprites. The setup guide takes its look from here |
| `471:11455` | Setup v2 kit |
| `471:11501`, `477:13531` | Setup v2 desktop frames, light and dark |
| `476:12712`, `477:14158` | Setup v2 phone frames, light and dark |
| `460:10192` | Hidden earlier states the guide follows where Setup v2 has no frame: taken address, provider suggestions, cropping, public email, private GitHub authorization and save states |
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

The editor shell (top bar, rail, panel, canvas outline, Add section gallery and the mobile dock and sheets) uses these controls. Below 1024 px the editor uses the phone layout, so the 768 px tablet gets the full-width preview and sheets. The Style panel uses Workbench tiles: native radios cover each theme and font tile, and Mode is a SegmentedControl. The Share panel, the Publish popover and the account menu use them too:

- **Publish** opens a popover under the top bar's button (Figma `414:8373`). Opening it, or a new saved revision while it is open, reads the saved draft's issues without pausing edits. Issues are listed by their label, with the section and icon underneath, and each opens its control: content issues the Build editor, address and sharing issues the Share panel, theme and font issues the Style panel. While issues are listed the button turns grey and the top bar's Publish button shows their count. Clicking Publish still checks the draft on the server and lists what blocks it. Before the first Publish the popover holds the address field, and Enter reserves it. The button reads Publish, Publish changes, Publishing (with a progress bar), or Try again, and a finished Publish shows "You're live" with Copy and Open until the popover closes or the draft changes.
- **Share** shows the address card (the field before the first Publish; the host, status, Copy and Open after it), the link preview with Title and Description, the sharing image and Unpublish.
- **The account menu** opens from the avatar with the owner's name and address, the sign-in methods, Sign out and Delete account.

The sharing image upload and the content editors keep their earlier bordered buttons and lime selection, in Geist, until phase 51.3 moves them.

## Initial setup

See [onboarding.md](onboarding.md) for the guide's behavior and layout. The guide uses the Workbench tokens and controls in both schemes, restyled after the pixel town landing (`553:2`): Host Grotesk instead of Geist (step titles are set like the landing's headings), the Silkscreen pixel font for the step kicker above each title, Geist Mono for the address and key caps, a white canvas in light mode, and lime (`#c4f25c`) for selection and the current progress segment. Nothing is outlined: every piece is a filled shape whose pixel-circle corners come from its clip-path, stepped on a 2 px grid in three sizes (small for buttons, pills and chips; medium for fields, lists and the avatar photo; large for cards, the Review frame and the avatar ring). Containers (cards, lists, the Review frame) sit on a warm surface (`#f4f3ef`, `#17171a` in dark) and popovers on a raised one (`#ffffff`, `#2a2a2f` in dark); fields, pills and secondary buttons take a deeper fill (`#e9e8e2`, `#232327` in dark). The only line is the 3 px focus ring on a focused answer field. The house sprite is the home mark and the cat sits on the address field. Its own pieces are in `setup-guide.css`: the 64 px answer field with its pill or key cap, the Setup v2 pills (selected ones turn lime), the surface cards, the Review frame with the landing's browser chrome, and the action row. The Profile card reuses the editor's image slots and crop dialogs (reposition, zoom, Reset, Apply crop, Cancel). Review uses the real shared renderer with the same device and scheme switch as the editor's top bar.

## Figma access

Use the connected Figma MCP to read design context, screenshots and assets. If it is unavailable or cannot open the file, say so and ask the user to connect it. Never claim to have inspected a design you could not open.

**The file is read-only.** Do not create, edit or delete anything in it unless the user asks for that change. If a change seems necessary, explain what and why and ask first. MCP access does not authorize writes.
