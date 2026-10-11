# Image assets

Both images were **generated for this prototype** and are bundled locally. They
are not scraped from a third-party site, so there is no attribution obligation
and no external request that could fail during a live demo.

| File | Used on | Size |
|---|---|---|
| `hero-grounded-ai.webp` | Landing page hero | 40 KB (1600×1195) |
| `login-study-desk.webp` | Login + Register split panel | 106 KB (1100×1473) |

## Why local files rather than Unsplash/Pexels URLs

The brief asked for imagery that "must actually render". A hotlinked
`images.unsplash.com` URL satisfies that today and breaks the moment the judge's
machine is offline, behind a firewall, or on a rate-limited CDN. Bundling the
files under `/public` makes the images deterministic.

Both are converted to **WebP** at ~40–106 KB, down from 2.1 MB and 2.6 MB as
2K JPEGs — a 96–99% reduction with no visible quality loss at display size.

## Usage notes

- `hero-grounded-ai.webp` is rendered with `next/image` and `priority` (it is the
  LCP element). `sizes` is set so mobile does not download the desktop size.
- `login-study-desk.webp` is decorative (`alt=""`, `aria-hidden`) and sits under
  an indigo scrim. The scrim is heavy by design: the photograph is warm-toned and
  needs a brand tint to harmonise, and the overlay is what carries WCAG AA contrast
  for the white text layered on top.

## Regenerating

Both were produced with the Matrix image generator using the prompts recorded in
this repo's build history. To change them, generate replacements at the same
aspect ratios (4:3 hero, 3:4 panel) and keep the filenames stable so no code
changes are needed.
