# UI direction

Use [hasaweb.site UI direction in Figma](https://www.figma.com/design/rjvDSCHPajF3Lpe8qNxX5U/hasaweb.site---Direction-A---SIDE-B?node-id=8-38&t=Yu7NSm3nQFBs7sQL-1) as the visual reference for this project.

Use the file to guide layout, typography, colors, spacing, and component appearance during UI development. Follow [product.md](product.md) for feature scope and [acceptance-criteria.md](acceptance-criteria.md) for required behavior.

## Initial setup direction

The [confirmed initial-setup specification](onboarding.md) uses the existing warm neutral surfaces, lime accent, DM Sans typography, and control language. The supplied Linktree screenshots inspire focused forms, prominent headings, generous whitespace, visible progress, and consistent navigation. They do not define product requirements, copy, a bio character limit, brand colors, or subdomain guarantees.

Use Address, one combined Profile step, Links, optional Skills/Projects/GitHub, then private Review. The Profile step includes both avatar and banner previews and shared crop dialogs with repositioning, zoom, Reset, Apply crop, and Cancel. Keep the original-file reselection limitation clear. Optional skip actions appear only after required setup. Review uses the actual shared portfolio renderer with desktop/mobile switching.

The seven original screenshots and two subsequent profile/crop references were inspected on October 16, 2026. Figma MCP read-only inspection covered the brand board at `8:2` and authentication screen at `12:48`; the linked starting node `8:38` is a brand element. The existing Figma reference contains no newly approved onboarding screens from this interview. Detailed responsive composition and final copy remain implementation design work within the agreed behavior. The separate theme/font/decoration catalog was subsequently approved in Phase 11E on October 17, 2026.

The seven original references use the filename pattern `Screenshot 2026-10-16 HHMMSS.png`, with timestamps `150350`, `150404`, `150421`, `150453`, `150519`, `150536`, and `150916`, under the owner's Pictures/Screenshots directory. Later attachments are `codex-clipboard-ca2ce52a-6749-4bb9-817f-c3cc4b87607a.png` and `codex-clipboard-7288e745-f153-4b6a-af49-ff30fa84510d.png`. Those machine-local references may need reattachment during implementation; they are not repository assets or instructions. No Figma file or linked FigJam journey map was modified by this planning task.

## Appearance catalog additions

On October 17, 2026, the owner explicitly requested three additional themes derived from their attached references. The resulting Foundations boards are [Matcha, `269:4`](https://www.figma.com/design/rjvDSCHPajF3Lpe8qNxX5U?node-id=269-4), [Strawberry, `269:223`](https://www.figma.com/design/rjvDSCHPajF3Lpe8qNxX5U?node-id=269-223) and [Coffee, `269:442`](https://www.figma.com/design/rjvDSCHPajF3Lpe8qNxX5U?node-id=269-442). Each has Light/Dark semantic variables, reference anchor colors and interface specimens. The code catalog uses those exact semantic values; its [Figma export](../specs/2026-10-17-appearance-catalog/figma-palettes.json) records the read-only integration evidence.

The [approved catalog](appearance-catalog.md) now contains Leaf, Violet, Clay, Matcha, Strawberry and Coffee, the existing three fonts, and only the imported Ginger cat and Hands decorations. The [source import](avatar-decorations.md) is the animation/geometry reference, including its reduced-motion states. The removed static decoration proposals are no longer choices. The owner approved the catalog, defaults, playback policy and generator exception in Phase 11E on October 17, 2026. These additions do not change onboarding, choose another template or authorize further Figma edits.

## Agent access through Figma MCP

Use the connected Figma MCP to inspect the reference and retrieve design context, screenshots, and assets as needed for implementation.

- File key: `rjvDSCHPajF3Lpe8qNxX5U`
- Starting node ID: `8:38`, represented as `8-38` in the URL.

If Figma MCP is unavailable or cannot access the file, report the access issue and ask the user to connect Figma MCP or grant access to the file. Do not claim to have inspected the design without access.

## Read-only during development

The Figma file is read-only during development. Do not create, edit, or delete anything in the file unless the user specifically asks for changes to it. If a file change is necessary to complete development and the user has not requested it, explain the proposed change and why it is needed, then ask for permission before making it. Reading the file through Figma MCP does not authorize writes.
