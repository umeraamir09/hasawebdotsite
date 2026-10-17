# Imported avatar decorations

The ginger cat and hands are a faithful source port from the owner's existing portfolio. They replace the proposed Leaf, Orbit and Frame static decorations. The component, CSS module, image loader, all seven named image/mask assets and cat generator are copied into the web package. [The provenance manifest](../specs/2026-10-17-avatar-decoration-import/source-manifest.json) records every file and its SHA-256 digest.

## Use the component

```tsx
import { ProfileAvatarSlot } from "./components/profile-avatar-slot";

<ProfileAvatarSlot />
<ProfileAvatarSlot decoration="hands" />
```

The unchanged `ProfileAvatar` export accepts only `decoration?: "cat" | "hands"` and defaults to cat. `ProfileAvatarSlot` supplies the independent positioning envelope and inherited variables. It reserves space above and below the absolute frame, including the fur and hands, without source-site `.profile` or `.profile-top` selectors. The slot sets portrait sizes to 124 px on desktop and 104 px at widths up to 760 px, with radius variables of 30/26 px. Hands uses those button radii directly; the cat button subtracts 6 px, giving 24/20 px radii. Preserve these source-specific differences. The cat's source CSS extends the portrait below the cleaned mouth and uses its original computed envelope and offsets. Keep the slot's complete box inside any clipped parent.

The slot maps `--surface`, `--raised` and `--border` to the app's existing tokens. A host can supply `--avatar-surface`, `--avatar-raised` and `--avatar-border` on an ancestor to override those mappings. No source font or Tailwind configuration is required. Next.js already supports CSS Modules and the app already uses React 19.3. The source's ref-as-prop image loader is retained.

The three source siblings are under `apps/web/components/`. Only `profile-avatar.tsx`'s `@/lib/assets` import changes to `../lib/avatar-assets`. That map contains exactly the illustration and photo entries. The CSS module and image loader are unchanged. Scoped Biome overrides preserve those exact source bytes and the generator/mask; the surrounding wrapper and review code remain linted and formatted normally. The source skeleton CSS is copied verbatim into the host's global stylesheet.

## Open the review

From the repository root:

```bash
pnpm dev:web --port 3000
```

Open [the actual component review](http://127.0.0.1:3000/catalog/avatar-decorations). Both variants are mounted independently with the original example portraits. Click, Enter and Space toggle the portraits. The source wipe, in-progress guard, six-second hand choreography, hearts and sparkles are retained. Reduced motion selects the cleaned cat still, stops hand/shimmer animations and skips the wipe.

The palette/font review at port 8791 links to this live review. It does not attempt to reproduce the React component or flatten the hands into a static image. Start the existing `node scripts/appearance-catalog-review.mjs --serve` separately for that palette review. The code catalog now includes Matcha, Strawberry and Coffee alongside Leaf, Violet and Clay, all with paired light/dark palettes. [The catalog decision](appearance-catalog.md) records their Figma provenance and final approval status. This source review uses the host tokens independently of theme selection.

The supplied images are explicit public review fixtures requested for this port. They never become a new owner's profile or accepted photo. The catalog's starting decoration remains absent and Face Reveal remains off. A component default of cat describes calling `ProfileAvatar` without a prop; it does not change portfolio provisioning defaults.

## Regenerate the cleaned cat

The exact 91-line source generator is at `apps/web/scripts/generate-avatar-decoration.mjs`, alongside its sibling `../public/assets/` directory. `sharp` is pinned to `0.35.5` in the web package. Run either command:

```bash
npm run generate:avatar
pnpm --filter @hasaweb/web generate:avatar
```

Both run the unchanged generator through a small integration wrapper that backs up both clean files and restores them if generation fails. Its inputs are the raw animated WebP, raw still and mouth mask. It writes the two clean files in place. Keep the source inputs at 212 × 220 with their original 32-frame timing. The runtime always references the clean files. To invoke the unwrapped source script directly, run `node apps/web/scripts/generate-avatar-decoration.mjs`.

### Observed environment limitation

On Node `22.22.1`, sharp `0.35.5`, libvips `8.18.7` and libwebp `1.6.0`, the verbatim script throws `Encoding changed the cleaned frames or animation timing.` Its all-channel byte comparison rejects RGB changes underneath completely transparent pixels. A diagnostic run found 1,021,531 differing hidden RGB bytes, **zero alpha differences and zero visible RGB differences**. The output retains all 32 frames, all frame delays, loop `0` and the 3,920 ms cycle. This is a failure of the source's stricter exact-byte guard in this environment, not a passing regeneration run.

The diagnostic did not change or bypass the checked-in script. The originally copied clean files were restored and their source digests verified. The faithful import therefore uses the source's original working assets. The raw generator writes its animation before the guard runs; a failed direct invocation can overwrite that file. Use the package script above for automatic restoration on failure. Resolving this guard would require a separately reviewed generator/environment change; the port does not silently weaken it.

## Verify the import

With the review server running:

```bash
npm run test:avatar:browser
pnpm exec vitest run scripts/avatar-import.test.ts packages/theme/src/catalog.test.ts
```

The browser command accepts another local origin as its positional argument. It checks the actual rendered source component, not a mock: delayed/cached/error images and stable skeleton bounds, two complete cat loops observed through compositor frames, both wipe directions for both variants, every hand animation family, keyboard focus/toggling, changing motion preferences, and the required 360/768/1280 widths. [Results and limitations](../specs/2026-10-17-avatar-decoration-import/results.md) distinguish the successful component verification from regeneration's exact-byte failure.

This is a source reference component, not the production portfolio renderer or owner photo editor. The source accessible button name is the fixed `Show photo of Umer Aamir`; its title, pressed state and image hidden states change as in the original. General owner identity, the product's `Reveal face`/`Show avatar` labels, publication/withdrawal behavior and the approved independent pause/play control still belong to the later renderer/Face Reveal integration. No source choreography or labels were edited to claim those later phases complete.
