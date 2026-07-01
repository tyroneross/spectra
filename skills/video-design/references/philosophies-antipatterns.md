# Design philosophies + anti-patterns (quick card)

Full prose: `SOURCE-GUIDE.md` Part VI (philosophies), Part VII (anti-patterns).

## Three schools
| School | Core belief | Works for | Fails for |
|---|---|---|---|
| **Minimalist** (Apple) | Product is the hero; remove anything that doesn't add information | Consumer apps, Apple Watch, macOS native, premium AI | Complex B2B (10+ features); dev tools where terminal/IDE chrome IS the product |
| **High-design** (Vercel/Linear/Stripe) | Design quality signals product quality; motion reveals architecture | Dev tools, AI platforms, design tools, startup launches | Consumer mass-market (reads exclusionary); non-technical enterprise buyers; costly to sustain solo |
| **Lo-fi/Authentic** (Loom/build-in-public) | Real people/screens/voices build trust faster than a motion-graphics budget | Founder-led social, Product Hunt, dev-tool demos, early-stage indie | Website hero (conversion-critical first impression); App Store; paid acquisition; large enterprise committees |

All three agree: one focus per frame, contrast is law, audio quality is the floor,
consistency beats variety, serve the viewer not the maker.

## Selector (audience + context → philosophy)
- Dev tools / AI, technical audience → **high-design** (credibility signal) or **lo-fi**
  (authenticity) — pick lo-fi for social/PH, high-design for site/product pages.
- Consumer → **minimalist** or **warm** variant of minimalist.
- Website hero / App Store → **breathe** register — minimalist or high-design, never lo-fi.
- Social (TikTok/Reels/Shorts) → **lo-fi** and **tight** cut rate.

## Visual anti-patterns → fix
- Logo intro (5s before content) → cut straight to the hook; logo in closing frame.
- Static talking head → intercut screen/zoom every 15–20s.
- Text repeating VO verbatim → keywords only, not full sentences.
- >3 lines of text at once → ≤30 chars/line, ≤3 lines, split across frames.
- Generic stock footage → real product UI only.
- Text/logo in platform safe zones → keep within per-platform safe zone (see `typography.md`).

## Audio anti-patterns → fix
- Music louder than VO → VO -6..-3 dBFS, music -15..-20 dBFS.
- Lyrics under VO → instrumental only.
- Script >200 WPM → cap at 150, up to 170 for short energetic cuts.
- Flat monotone delivery → vary pitch/pace/emphasis or recast VO talent.
- Dead air >2s with no visual change → plan visual activity for every moment.

## Structural anti-patterns → fix
- >1 CTA → exactly one action, one verb.
- Features before problem → establish pain first.
- "We're excited to announce..." → open on the problem or product in action.
- No pattern interrupts in long video → break every 20–40s at content boundaries.
- Feature montage with no story → problem → solution → proof → CTA spine.
