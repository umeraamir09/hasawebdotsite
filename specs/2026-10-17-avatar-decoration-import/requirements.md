# Avatar decoration import requirements

The owner explicitly requests a faithful reusable React port from `/home/umer/umers-portfolio-website`, including both `cat` and `hands`, their source choreography, portrait toggle, skeleton loader, all named assets, and regeneration tooling. Source commit at inspection is `88a9dc7d5128d361164243932e8bacb7cdf52730`; record copied working-file hashes as the actual provenance.

The three sibling source files and the generator must remain byte-identical except for the one allowed asset-map import replacement. Keep `decoration?: "cat" | "hands"`, default cat, source accessible labels/alt text and original animation timings. Do not introduce another animation framework or copy the source site's fonts/layout/configuration.

The list names seven image/mask assets and one generator, despite calling them eight assets. Copy all eight listed support files. Assets belong under `apps/web/public/assets`; the verbatim generator belongs under `apps/web/scripts` so its relative URLs remain valid. Expose `generate:avatar` in both the web package and repository root.

Use React 19.3 already installed. Declare a pinned `sharp` development dependency. Provide the source skeleton rules globally and the required inherited CSS variables through a separate reusable wrapper. Match source desktop/mobile dimensions and breakpoint. Preserve overflow room for cat fur and hands without relying on `.profile` or `.profile-top` from the original site.

The review page renders actual imported components. Imported Umer identity/images are explicit review fixtures, never provisioned owner content. Keep catalog default decoration absent and Face Reveal off. No Figma writes, authentication changes, database migrations, catalog approval or later roadmap completion are part of this port.
