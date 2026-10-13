# StudyMind illustrations

These locally bundled illustrations are AI-generated. They are served from the app's public directory, so the UI does not depend on a remote image host. WebP files were converted at quality 80; all listed assets are below 150 KB.

The request referenced twelve PNGs in `web/public/images/new/`, but that folder was not present in the repository. Nine supplied JPEGs were available instead. They were converted to WebP; three suitable images are intentionally reused for both a How It Works step and a related role (step 1/login, step 2/empty map, and step 3/Open Graph). The Open Graph image is a 1200×630 crop derived from the step 3 source.

| File | Dimensions | File size | Usage |
|---|---:|---:|---|
| `hero.webp` | 1024×683 | 34,260 bytes (34.3 KB) | Landing-page hero |
| `login.webp` | 768×1024 | 56,742 bytes (56.7 KB) | Login panel; reused for How It Works step 1 |
| `register.webp` | 768×1024 | 33,082 bytes (33.1 KB) | Registration panel |
| `step-1.webp` | 768×1024 | 56,742 bytes (56.7 KB) | How It Works: step 1; same art as login |
| `step-2.webp` | 1024×1024 | 61,800 bytes (61.8 KB) | How It Works: step 2; reused for the empty course map |
| `step-3.webp` | 1024×536 | 18,712 bytes (18.7 KB) | How It Works: step 3; source for `og.webp` |
| `step-4.webp` | 1024×1024 | 28,428 bytes (28.4 KB) | How It Works: step 4 |
| `empty-library.webp` | 1024×1024 | 29,618 bytes (29.6 KB) | Knowledge-base empty state |
| `empty-map.webp` | 1024×1024 | 61,800 bytes (61.8 KB) | Course-map empty state; same art as step 2 |
| `empty-notes.webp` | 1024×1024 | 32,202 bytes (32.2 KB) | Revision empty state |
| `cta.webp` | 1024×320 | 12,382 bytes (12.4 KB) | Landing-page call-to-action background |
| `og.webp` | 1200×630 | 22,984 bytes (23.0 KB) | Open Graph and Twitter social preview metadata |

## Implementation notes

- The landing hero uses `SafeImage` with priority loading; secondary imagery loads lazily.
- `SafeImage` reserves its image aspect ratio and renders a branded gradient fallback if an image fails to load.
- Empty-state artwork is decorative because the adjacent heading and description convey the same meaning; it uses empty alt text and is hidden from assistive technology.
- Auth page artwork and all landing imagery are presentation-only. The image changes do not alter authentication, tutor, or learner-model behavior.
