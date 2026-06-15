# KavaCrawl Landing Page — Design Spec

**Date:** 2026-06-14  
**Subdomain:** `kavacrawl.shapehaveninnovations.com`  
**Hosting:** GitHub Pages (`wolfayet0855/KavaCrawl-Site` repo)  
**DNS:** Cloudflare (CNAME → `wolfayet0855.github.io`)  
**Privacy policy:** `https://shapehaveninnovations.com/privacy.html`  
**App Store link:** `https://apps.apple.com/gb/app/kavacrawl/id6772610237`

---

## Visual Identity

| Token | Value |
|---|---|
| Background (deep) | `#0a1f1a` |
| Background (mid) | `#0d2b24` |
| Gold / accent | `#c9a84c` |
| Cream / text | `#f5f0e8` |
| Muted text | `rgba(245,240,232,0.5)` |
| Sub text (green-tinted) | `rgba(157,184,160,0.85)` |

**Typography:** System serif (`Georgia`) for headings (italic, heavy); system sans-serif for body, labels, nav.  
**No emojis anywhere.**  
**No hibiscus watermark decorations** — clean dark teal background only.

---

## Page Sections (top to bottom)

### 1. Hero
- Full-viewport-height dark teal section with radial gradient
- **Nav bar** (absolute, top): wordmark `KAVACRAWL` in gold left; `Privacy Policy` link right
- **Logo** (`KC_LM_O.png`) centered, 100×100px, circular, with gold glow shadow
- **Eyebrow:** `WELCOME TO THE ISLAND` — gold, 10px, 5px letter-spacing, uppercase
- **H1:** *"Your island crawl starts here."* — cream, italic serif, ~60px, bold
- **Subtitle:** "Discover kava bars, tea houses & hidden gems near you. Live check-ins, crawl routes & a community that knows the scene." — muted green-tinted, 15px
- **CTA row** (centered):
  - Gold pill button → App Store link (with Apple logo SVG icon)
  - QR block: white-boxed `KavaCrawl_QR.png` (80×80), "SCAN TO DOWNLOAD" caption, "Android coming soon" gold pill badge beneath
- **Pagination dots** (5 dots, one active/gold bar) — decorative, matching app onboarding style

### 2. Stats Band
Full-width dark band (`#091a14`) with four cells separated by faint gold borders:

| Label | Value |
|---|---|
| Kava Venues | 500+ |
| Check-ins | Live |
| iOS App | Free |
| Coverage | Nationwide |

### 3. Features
Dark teal section with radial gradient. Four cards in a CSS grid (auto-fit, min 220px).

Each card: dark glass panel (`rgba(255,255,255,0.04)`) with gold border, gold uppercase tag, italic serif heading, muted body text.

| Tag | Heading | Body |
|---|---|---|
| Discover | Find every kava bar near you. | Ratings, hours & distance at a glance. Filter by type. |
| Navigate | See the scene on the map. | Live check-ins, friends nearby & open bars pinned. |
| Crawl | Build your crawl route. | Pick your stops, set the order & hit start. |
| Community | Events, vibes & the crew. | See what's happening tonight at every bar near you. |

### 4. Screenshots
Dark section (`#08140f`). Eyebrow + italic serif H2. Four phone frames side-by-side (horizontal scroll on mobile), each showing one App Store screenshot PNG (`KavaCrawl_AppStore_6.5_01–04.png`). Frames styled with gold border ring and drop shadow.

### 5. Lifestyle / Culture
Dark teal section. Two-column grid (image left, text right):
- **Left:** `ChatGPT Image Jun 2, 2026` (guy holding kava at sunset) — square, rounded corners, gold ring shadow
- **Right:** eyebrow, italic H2 *"More than a bar guide. It's a way of life."*, body copy, secondary App Store button

### 6. Footer
Near-black (`#060e0b`) with gold top border. Centered stack:
- Logo (38px circular) + wordmark `KAVACRAWL`
- Tagline: `TEA & KAVA DISCOVERY`
- Links: Privacy Policy, App Store
- Copyright: `© 2026 Shape Haven Innovations. All rights reserved.`

---

## Assets

| File | Usage |
|---|---|
| `assets/KC_LM_O.png` | Logo (hero + footer) |
| `assets/KavaCrawl_QR.png` | QR code in hero CTA |
| `assets/AppStore/KavaCrawl_AppStore_6.5_01.png` | Screenshot — Welcome |
| `assets/AppStore/KavaCrawl_AppStore_6.5_02.png` | Screenshot — Discover |
| `assets/AppStore/KavaCrawl_AppStore_6.5_03.png` | Screenshot — Map |
| `assets/AppStore/KavaCrawl_AppStore_6.5_04.png` | Screenshot — Crawl |
| `assets/lifestyle.jpg` | Lifestyle section photo (rename from `ChatGPT Image Jun 2, 2026, 10_22_33 PM.png` — spaces in filename must be resolved at copy time) |

---

## Deployment

### GitHub Pages
- Repo: `wolfayet0855/KavaCrawl-Site`
- Branch: `main`, root serves `index.html`
- Custom domain file: `CNAME` containing `kavacrawl.shapehaveninnovations.com`

### Cloudflare DNS
Add CNAME record in shapehaveninnovations.com zone:
```
kavacrawl.shapehaveninnovations.com → wolfayet0855.github.io (proxied: false)
```

### .gitignore
```
.claude
docs
.superpowers
.DS_Store
```

---

## Implementation Notes

- Pure static HTML + CSS — no build step, no JS framework
- Single `index.html` at repo root; assets copied into `assets/` directory
- `CNAME` file at repo root for GitHub Pages custom domain
- Responsive via CSS `clamp()` for font sizes, `auto-fit` grid for feature cards, horizontal flex-wrap for phone row
- Google Maps API is used in the iOS app itself — not referenced on this landing page
