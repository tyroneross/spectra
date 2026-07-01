# Video Design & UX Companion Guide
### Visual Language, Emotion, Sound, Pacing, Typography, and Voice — By Channel and Audience

***

## Executive Summary

Great product video is an act of emotional engineering. Every decision — the color on screen, the cut rate, the pace of a voiceover, how many words appear per frame — either reduces or amplifies cognitive friction. The science is clear: humans make purchase decisions emotionally first, then justify with logic. The design job in a product marketing video is to manufacture the right emotion at each moment, deliver information at the right density for the brain to absorb it, and guide the viewer to a single action. This guide covers the full visual and experiential design layer of product video production, including the research-backed rules, the competing philosophies, where they agree, and where they conflict.[^1]

***

## Part I: The Emotional Design Framework — Feel, Think, Do

Every frame in a video is doing one of three things: creating an emotional state, building a cognitive model, or motivating an action. Good video design sequences these deliberately.[^1]

Harvard Business School professor Gerald Zaltman's research establishes that 95% of purchase decision-making occurs in the unconscious mind. The practical implication: design for emotion first, logic second, action third. In video, this maps directly to the funnel.[^1]

### Emotion by Funnel Stage

| Stage | Target Emotion | What to Make Them Feel | What to Make Them Think | What to Make Them Do |
|---|---|---|---|---|
| **TOFU (Awareness)** | Curiosity + Recognition | "This person understands my problem" | "This is a real problem I have" | Watch more / follow / save |
| **MOFU (Consideration)** | Confidence + Intrigue | "This might actually solve it" | "This product fits my workflow" | Visit website / sign up for demo |
| **BOFU (Decision)** | Trust + Urgency | "I can safely say yes to this" | "The ROI is justified" | Start trial / book demo / buy |
| **Post-Purchase / Retention** | Pride + Belonging | "I made the right call" | "I want to use more of this" | Share / expand / upgrade |

### The Emotional Sequence Within a Single Video

Within any single video, the emotional arc should follow a specific progression — not maintain a flat tone throughout:[^1]

1. **Recognition (0–5s):** Viewer identifies with the pain state. Design goal: provoke a nod or "yes, that's me."
2. **Tension (5–20s):** Amplify the stakes. Design goal: create mild discomfort that demands resolution.
3. **Relief (20–40s):** Show the solution working. Design goal: release the tension through product demonstration.
4. **Conviction (40–60s):** Proof and social validation. Design goal: ratify the emotional purchase decision with logic.
5. **Direction (final 10s):** Single clear CTA. Design goal: make the next step frictionless and obvious.

This is the emotional logic behind the story spine from the companion guide. The design layer's job is to **amplify each phase**, not fight against it.

***

## Part II: Color Psychology for Software and AI Products

### The Core Color Map for Tech Audiences

Color triggers emotional associations before the viewer processes a single word. First impressions form in under 50 milliseconds, and color is the dominant signal in that window.[^2][^3]

| Color | Primary Emotion | When to Use in Video | Risk / Anti-Pattern |
|---|---|---|---|
| **Deep/Royal Blue** | Trust, stability, professionalism | Enterprise B2B, security products, infrastructure tools | "Brand blending" — every SaaS competitor uses it[^4] |
| **Electric Blue / Indigo** | Intelligence, future, innovation | AI agents, ML tools, premium developer platforms[^5] | Can read as cold or sterile without warm accents |
| **Emerald / Neon Green** | Growth, success, action | CTAs, completion states, productivity apps, fintech[^5] | Avoid for error/warning states — causes semantic confusion |
| **Near-Black / Dark Charcoal** | Authority, power, premium | Developer tools, CLI apps, macOS native apps, AI platforms[^4] | Long passages in dark mode reduce text legibility if not contrast-checked |
| **White / Off-White** | Clarity, simplicity, space | Minimalist Apple-adjacent design, consumer apps, clean demos | Blank and undifferentiated without strong type and accent work |
| **Purple / Deep Violet** | Creativity, intelligence, premium tier | Design tools, cutting-edge AI, premium/pro features[^5] | Can feel abstract or luxury-exclusive — use for differentiation not core identity |
| **Orange** | Energy, innovation, approachability | Indie developer products, prosumer tools, action/CTA buttons[^4] | Reads as playful — avoid in pure enterprise security contexts |
| **Red** | Urgency, action, danger | CTAs only, limited-time offers, error states | Never use as a primary product color in B2B — triggers caution[^3] |

### The 60-30-10 Color Rule for Video Frames

For any designed frame or slide in a video, apply this composition principle:[^5]

- **60% Primary (neutral):** Background — white, light gray, deep charcoal, or matte black. Provides the visual canvas.
- **30% Secondary (brand):** Your core brand color. Creates recognition and cohesion across all frames.
- **10% Accent (CTA/highlight):** High-contrast pop color for the thing the viewer must look at — the metric, the feature name, the CTA text, the key UI element.

### Dark Mode vs. Light Mode: When to Choose Which

Dark mode is no longer an "extra" — for developer tools and AI platforms, it is increasingly the default in 2026.[^5]

- **Dark mode:** Signals premium tech, reduces eye strain, makes colorful data visualizations "pop," resonates strongly with developer audiences. Use for: CLI tools, AI agents, developer platforms, native macOS/Apple Watch demos.
- **Light mode:** Better for readability of long-form text, general business tools, and workflows where the interface resembles consumer software or documents. Use for: productivity web apps, consumer iOS apps, B2B SaaS demos for non-technical buyers.

If your product supports both, default to the mode that reflects how your primary audience actually uses it. Never choose light mode just because it photographs better.

### Color and Funnel Stage

Apply color strategically across the video's arc:[^5]
- **Awareness moments:** More vibrant, saturated, high-energy — designed to interrupt scrolling
- **Evaluation / demo moments:** Cleaner, more balanced palette — push focus to the product UI, not the graphics
- **Conversion moments (CTA frame):** All distraction eliminated; the only high-contrast element on screen is the CTA action

***

## Part III: Typography — Size, Density, and Motion

### The Cognitive Load Foundation

Text in video interacts with two channels in the brain: visual and auditory. When on-screen text simply repeats what the voiceover is saying verbatim, research across multiple studies shows **learning decreases** — this is the Redundancy Effect. The brain cannot efficiently read and listen to the same words simultaneously.[^6][^7]

**The practical rule:** On-screen text should either (a) carry a message the VO does not speak, (b) reinforce a keyword or concept without duplicating full sentences, or (c) serve as a visual anchor for sound-off viewing. It should never simply transcribe the VO word-for-word alongside the audio.[^8]

**The exception:** For complex software tutorials (like showing a feature in an AI agent product), recent research finds that spatially integrated visual signaling — callouts, highlights, arrows pointing to UI elements — even when redundant with narration, actually *reduces* extraneous cognitive load and improves retention. The key is **spatial integration**: the signal must be directly on or near the relevant UI element, not in a caption bar separate from the action.[^9]

### Text Density Rules Per Frame

| Context | Max Words Per Frame | Notes |
|---|---|---|
| Marketing/social video | 5–15 words | At high information pace; 6 words optimal for thumb-scroll hook[^10] |
| Product demo overlay | 10–20 words | For callouts and instruction text[^11] |
| Tutorial step label | 5–10 words per callout | Appear before the action, not after[^12] |
| Slide-based explainer | 20 words ideal, 40 words max | Research consensus across multiple pedagogical frameworks[^13][^14][^15] |
| Caption / subtitle line | Max 30 characters (1–2 lines) | No more than 3 lines on screen at once[^11] |

### Font Size Minimums by Format

The minimum readable font size on a smartphone at normal distance for Full HD (1920×1080) video:[^11]

- **Body/caption text:** 40–60px (Minimum; 58px is the scientifically recommended floor for average visual acuity at smartphone distance)
- **Headline/callout text:** 60–90px (at least 50% larger than body text)[^11]
- **Slides / presentation context minimum:** 32pt+ for accessibility, 24pt absolute floor[^13]
- **Social video (9:16 vertical):** Size up another 20–30% — these are viewed on smaller screens at arm's length

**Font choice:** Dynamic sans-serif typefaces (Inter, SF Pro Display, Calibri, Open Sans, Frutiger) are recommended for video text over decorative or serif fonts. They maintain legibility at small sizes and at compression quality levels typical of platform video encoding.[^11]

### Text Dwell Time

Every text frame must remain on screen long enough to be read:[^11]

- Minimum: 1 second per 13 characters
- A 30-character caption line requires at least 2.3 seconds on screen
- For animated/kinetic text: calculate dwell time after the text has finished animating in — the animation does not count toward the reading window[^11]
- If the cut comes before a viewer can read the text twice through, the text is too long or too fast

### Safe Zones — Where to Place Text by Platform

Never place critical text, logos, or CTAs in platform UI zones. The following are exact content safe zones:[^16][^17]

| Platform | Format | Keep Content Within (px) | Bottom Buffer | Notes |
|---|---|---|---|---|
| TikTok (organic) | 1080×1920 (9:16) | 900×1492 centered | ≥320px from bottom | Right-side buttons also block content |
| Instagram Reels | 1080×1920 (9:16) | 1010×1280 centered | ≥250px from bottom | Caption + action UI at bottom |
| YouTube Shorts | 1080×1920 (9:16) | 984px wide, start at y:120 | ≥400px from bottom | Subscribe button overlaps bottom-left |
| LinkedIn feed (mobile) | 1920×1080 or 1080×1350 | Center 85%, 15% buffer all sides | Varies | 4:5 (1080×1350) performs ~30% better on mobile[^17] |
| YouTube (16:9) | 1920×1080 | Center 80% | Bottom 80px for subtitles | Ample safe zone vs. vertical formats |
| App Store video | Device-specific portrait | No text required (Apple rules) | N/A | No on-screen text allowed in App Store previews |

**Universal vertical video safe zone for cross-platform posting:** Center 900×1400px within a 1080×1920 canvas.[^16]

### Kinetic Typography and Motion Text

Kinetic typography — text animated to move, scale, appear, or transform on screen — increases engagement when applied correctly. Core principles:[^18][^19]

- **Sync to beat or VO rhythm:** Text should animate in **on** the beat or spoken word, not slightly before or after[^20]
- **One concept per motion:** Animate one element at a time — never simultaneously fly in multiple text elements
- **Varied motion, not varied chaos:** Use the same animation style consistently; variation in *when* and *emphasis* creates interest, not variation in which animation effect is used[^18]
- **Speed of entry matches energy:** Slow fade-in = calm/serious tone; fast snap/scale = energy/urgency
- **Dwell on the important:** Hold the high-impact word or metric for 2–3x longer than the surrounding words
- **Motion economy:** Movement should feel purposeful; motion that exists only because After Effects makes it easy is visual noise[^18]

***

## Part IV: Sound Design — Music, VO, and Silence

### Music: The Emotional Primer

Music shapes the emotional state of the viewer before the product is ever shown. It is the first impression that sets the interpretive lens for everything that follows.[^21]

**The music selection framework:**

| Product Type | Audience | Music Direction | Tempo | Examples |
|---|---|---|---|---|
| AI agent / developer tool | Technical | Sparse, ambient, electronic; no distracting lyrics | 80–100 BPM | Boards of Canada-adjacent, lo-fi electronic |
| Consumer iOS app | General | Warm, bright, melodic; upbeat without being aggressive | 100–120 BPM | Light pop-adjacent, indie-folk instrumentals |
| macOS / productivity | Power user | Clean, modern minimal; slight texture | 90–110 BPM | Minimal piano, clean electronic, ambient |
| Enterprise B2B | Buyer/exec | Confident, forward-moving, professional | 100–115 BPM | Orchestral tech, "motion" soundtrack style |
| Apple Watch / health | Consumer | Light, optimistic, energetic | 110–125 BPM | Energetic acoustic or light electronic |
| Product Hunt launch | Dev/founder | Punchy, fast, builds | 115–130 BPM | Electronic with clear momentum and release |

**Music volume:** Mix at -15 to -20 dBFS when VO is present. Music should be felt, not heard. Dip by an additional 3–6 dB at moments of heavy on-screen text or product UI focus.[^21]

**Lyric rule:** Never use music with audible English lyrics behind English VO or subtitle-heavy content. Lyrics compete directly with verbal processing in the brain.[^21]

### Voiceover: The Pacing Science

Voiceover pace is one of the most measurable and highest-leverage production decisions, and it varies significantly by use case:[^22]

| Pace Category | WPM Range | Best For |
|---|---|---|
| Slow / deliberate | 110–120 WPM | E-learning, complex technical narration, enterprise explainers for non-technical buyers[^23] |
| Conversational / natural | 130–150 WPM | Most product explainers, corporate video, tutorials, YouTube content[^24][^25] |
| Up-tempo / confident | 150–170 WPM | Feature launches, energetic demos, founder-led LinkedIn content[^26] |
| Commercial / fast | 170–200 WPM | Social ads, short-form promos, high-energy launch videos[^22][^26] |
| Too fast | >200 WPM | Listener fatigue; audio comprehension degrades rapidly above this threshold[^24] |

**The 150-word rule:** 150 words ≈ 1 minute of natural conversational voiceover. Any script that asks a VO to deliver 225+ words in a 60-second slot will either sound rushed or require editing that makes the final cut feel frantic.[^25]

**Density ceiling by video type:**
- Marketing / social video with narration: 120–200 words per minute of runtime[^10]
- On-screen text only (no VO): 60 words per minute of runtime for marketing content[^10]
- Technical tutorial: 100–130 WPM to allow visual processing to catch up with audio

### The Silence Variable

Silence is an underused design tool. Well-placed pauses:[^27]
- Give the viewer's brain time to process a key concept or visual
- Create emphasis — the beat after a "wow moment" in the product demo
- Break tension before the CTA

Add 0.5–1 second of relative quiet before and after the most important claim or metric in the video. This is not "dead air" — it is white space for the auditory channel.

### Voice Tone and Character

The voice character should match the audience's self-image, not the founder's preference:[^28]

| Audience | Voice Style | What to Avoid |
|---|---|---|
| Developers | Peer-level, dry, slightly informal, technical without stumbling | Over-enthusiastic marketing voice; slow molasses delivery |
| Enterprise buyers | Confident, professional, measured, authoritative | Startup-casual or overly upbeat; sounds unsophisticated to risk-averse buyers |
| SMB / prosumer | Friendly, practical, relatable, warm | Corporate stiffness; also avoid excessive tech jargon |
| Consumer (iOS/Watch) | Energetic, natural, delightful | Robotic or monotone AI VO (even if technically clean) |
| Product Hunt / launch | Founder energy: genuine excitement, not performed | Polished ad voice — this audience rewards authenticity and punishes corporate polish |

***

## Part V: Pacing and Cut Rate — The Rhythm of Attention

### What Cut Rate Does to the Brain

Cuts are the fundamental unit of attention management. Every cut is a pattern interrupt — it recalibrates the viewer's attention and resets their risk of disengagement. The right cut rate varies dramatically by platform and content type.[^29]

### Cut Rate Guidelines by Context

| Context | Cuts Per Minute | Notes |
|---|---|---|
| TikTok / Reels / Shorts | 30–60 (1 cut every 1–2s) | Short-form scrolling demands constant novelty; single cut lasting 3s+ often causes drop-off[^30] |
| LinkedIn feed video | 15–30 (1 cut every 2–4s) | Slightly slower — B2B audience tolerates more information density per shot |
| YouTube product demo | 8–15 (1 cut every 4–7s) | Allow the UI to breathe; viewer needs time to process what they're seeing |
| YouTube tutorial (long-form) | 6–12 (1 cut every 5–10s) | Consistent with VO pace; cuts match natural topic transitions |
| App Store / Product Hunt | 15–25 (1 cut every 2–4s) | Hook-optimized; must justify viewer time quickly |
| Social ad (paid) | 20–40 (hook first 3s critical) | First 3 seconds must contain 2+ cuts to stop scroll[^31] |

**The 3-second rule for social:** TikTok data shows the decision to swipe happens within 3 seconds. The first cut in any short-form video should arrive by second 1.5–2, and the visual or audio hook must have landed by second 3.[^31]

### Pattern Interrupts

A pattern interrupt is anything that breaks the visual or auditory rhythm to recapture attention that is beginning to drift. Use them every 20–40 seconds in longer content:[^29]

- **Visual:** B-roll cut, zoom-in to UI element, screen recording after talking head (or vice versa)
- **Audio:** Sudden music swell or cut, VO tone shift, sound effect
- **Text:** Kinetic text pop or large callout after a run of plain VO narration
- **Reframing:** New angle, new environment, new speaker

Pattern interrupts in the wrong places destroy pacing. A pattern interrupt mid-sentence or mid-workflow demo feels choppy, not dynamic. Time them to **content boundaries** — at the end of a point, not in the middle of demonstrating a feature.

### The "One Idea Per Beat" Principle

Each visual segment — the time between two cuts — should contain exactly one idea. If a shot is doing two things (explaining AND demonstrating AND showing proof), split it. The viewer's brain cannot simultaneously:[^12][^32]
- Read on-screen text
- Watch a UI interaction
- Process VO delivering a new concept

This is not subjective — it is supported by Cognitive Load Theory. Working memory has a hard capacity; exceeding it does not make the viewer work harder, it makes them disengage.[^33]

### Smoothness vs. Choppiness: The Philosophy Conflict

There are two legitimate schools of thought on pacing philosophy, and both are right in different contexts:

**The "Tight Edit" School (MrBeast / YouTube growth era):** Every second of dead air is cut. Pauses are eliminated. Energy is maintained through relentless cuts and B-roll. This approach maximizes algorithmic metrics (watch time, completion rate) on YouTube and social platforms. It can feel exhausting in a 5+ minute video and is completely wrong for enterprise or developer audiences who interpret rapid cutting as hype, not substance.[^34][^35]

**The "Breathe" School (Apple / Wistia design philosophy):** Shots are held longer. Silence is used deliberately. Single product interactions are shown cleanly without overlapping narration. The pace communicates confidence — the product doesn't need constant stimulus to maintain interest. This approach works for premium product positioning and technical audiences. It fails on social where the algorithm penalizes lower engagement velocity.[^36]

**Where they agree:** Neither school advocates for long pauses with nothing happening. Both agree on ruthless cutting of any moment where neither the visual nor the audio is delivering new information.

**Resolution:** Use the Tight Edit approach for social (LinkedIn, Shorts, TikTok, Reels). Use the Breathe approach for website hero videos, App Store previews, and developer documentation demos. Use a blend for YouTube tutorials — breathe during UI demonstrations, tight during commentary transitions.

***

## Part VI: Design Philosophies — Minimalism vs. High Design

### Minimalist Design (Apple School)

The minimalist approach is characterized by large whitespace, few elements on screen at any time, high-contrast typography, no decoration for decoration's sake, and product UI presented without chrome or surrounding context.[^36]

**Core belief:** The product is the hero. Every design element competes with the product for attention. Remove everything that does not add information. Trust the viewer to fill in the blank.

**Emotional output:** Premium, confident, clear, modern. Works for: consumer apps, Apple Watch, macOS native apps, premium AI tools.

**Execution rules:**
- One dominant element per frame
- 60%+ whitespace or negative space on any given frame
- Text in 2 weights maximum (bold for emphasis, regular for body)
- 1 accent color per palette, used sparingly
- Transitions: fades, subtle dissolves, or direct cuts — no swoops, spins, or bounces
- Music: ambient, low-presence, minimal

**Where minimalism fails:** Complex B2B products with 10+ features. Developer tools where the terminal, logs, and IDE chrome ARE the product. Minimalism can leave enterprise buyers asking "but what does it actually do?" — the missing context creates uncertainty, not sophistication.

### High-Design / Kinetic (Vercel / Linear / Stripe School)

High-design approach uses rich motion graphics, dark backgrounds, neon accents, glassmorphism, gradient meshes, and strongly art-directed typography. Common in premium developer tools and ambitious B2B startups.[^5]

**Core belief:** Design quality is a product quality signal. A beautifully crafted brand video tells the viewer that the team cares about details. For technical audiences who notice design, this builds immediate credibility.

**Emotional output:** Modern, premium, ambitious, technically sophisticated. Works for: dev tools, AI platforms, design tools, startup launches.

**Execution rules:**
- Dark mode as default
- Rich but controlled palette (near-black + 1–2 vivid accents)
- Typography as a design element (not just a legibility tool)
- Motion graphics that reveal the product's architecture, not just screenshot it
- Transitions: smooth eases, physics-based, never jarring
- Music: produced, specific, often curated to match brand energy

**Where high-design fails:** Consumer mass-market apps where it reads as exclusionary. Non-technical enterprise buyers who find it confusing or "too startup." The production cost and time investment is also significant — a solo founder cannot maintain this standard across a content flywheel.

### Lo-Fi / Authentic (Loom / Build-in-Public School)

The lo-fi approach leans into imperfection, founder-led demos, screen recordings without device frames, talking-head iPhone footage, and raw candor about what the product can and cannot do.[^37][^38]

**Core belief:** In a world of AI-generated hyper-polish, authenticity is differentiation. Real people, real screens, real voices talking straight to camera build trust faster than any motion graphics budget.

**Emotional output:** Trustworthy, relatable, honest, accessible. Works for: founder-led social content, Product Hunt launches, developer tool demos, early-stage indie products.

**Execution rules:**
- Real screen recordings, not mockups
- Founder or engineer on camera (or VO) speaking naturally
- No logo animations or intro sequences
- Captions still required (technical quality floor)
- Good audio is still mandatory — the only non-negotiable technical requirement
- Music optional; if used, very low-key

**Where lo-fi fails:** Website hero videos where first impressions drive conversion. App Store previews. Paid acquisition creative where production value signals product quality. Enterprise sales materials shown to large committees.

### Where the Philosophies Agree

Despite their differences, all three schools share a set of non-negotiable principles:

1. **One focus per frame** — do not crowd the screen with competing elements
2. **Contrast is law** — text must be readable in all lighting and on all screens
3. **Audio quality is the floor** — bad audio disqualifies any production style
4. **Consistency beats variety** — visual system should be coherent; random style mixing signals carelessness
5. **Serve the viewer, not the maker** — every design choice should help the viewer understand and decide faster, not showcase design capability

***

## Part VII: Anti-Patterns — What Kills Engagement

These are the most common and most damaging design and production mistakes in software product videos.

### Visual Anti-Patterns

| Anti-Pattern | Why It Fails | Fix |
|---|---|---|
| **Logo intro sequence** (5s animation before content starts) | Viewers skip or disengage before content begins; 0% information density in the most valuable seconds[^29] | Cut to the hook immediately; put logo in lower third or closing frame |
| **Talking head with no visual movement** | Static visual field = attention drift within 10–20 seconds[^27] | Intercut with screen recording, UI zoom-ins, or motion graphics every 15–20s |
| **Text that verbatim repeats the VO** | Redundancy Effect — cognitive overload, decreased retention[^7][^6] | Text reinforces keywords, not full sentences; use for sound-off emphasis only |
| **More than 3 lines of on-screen text at once** | Exceeds readable density at normal video viewing distance[^11] | Max 30 characters per line, max 3 lines; split into multiple frames if needed |
| **Generic stock footage** (people pointing at laptops, handshakes) | Signals inauthenticity; erodes trust; looks like every other enterprise video | Use real product UI, real screen recordings, real customer contexts |
| **Low-contrast text** | Unreadable on mobile screens in bright light | White text on dark semi-transparent background or vice versa; test at thumb size |
| **Text or logo in platform UI safe zones** | Hidden by captions, profile icons, action buttons[^16] | Keep all critical content in center 900×1400 for vertical; tested per platform |
| **Animation style inconsistency** | Chaotic, amateurish; different transitions every cut | Choose 1–2 transition styles and apply consistently throughout |
| **Designing for desktop only** | 80%+ of social video is consumed on mobile[^39] | Preview every text element at 375px wide equivalent |
| **Dark background + dark text** | Fails in dark mode and in bright outdoor viewing | Always check contrast ratio; minimum 4.5:1 for body text (WCAG AA)[^5] |

### Audio Anti-Patterns

| Anti-Pattern | Why It Fails | Fix |
|---|---|---|
| **Background music louder than VO** | Viewer exhausted trying to parse words through the mix | VO should be -6 to -3 dBFS; music at -15 to -20 dBFS[^21] |
| **Music with English lyrics under English VO** | Lyrics compete directly with VO in the verbal processing channel[^21] | Use instrumental-only tracks |
| **Script at >200 WPM** | Listener fatigue; comprehension drops sharply above this rate[^24] | 150 WPM is natural conversational pace; scale up to 170 max for short energetic videos |
| **Flat monotone delivery** | Engagement drops significantly with non-varied vocal energy[^28] | Vary pitch, pace, and emphasis; hire VO talent if founder delivery is flat |
| **Dead air >2 seconds without visual change** | Viewers read this as "loading" or "broken"[^29] | Plan visual activity for every moment; even subtle motion counts |
| **Mismatched music tone** | Upbeat pop behind a serious enterprise problem statement undermines credibility[^21] | Match music emotional register to content stage (tension builds through problem section) |

### Structural Anti-Patterns

| Anti-Pattern | Why It Fails | Fix |
|---|---|---|
| **More than 1 CTA** | Splits attention; paradox of choice reduces conversion | End on exactly one action with one verb |
| **Features before problem** | Viewer has no frame for why features matter | Always establish pain/context before demonstrating solution |
| **Over-explaining** | Treats the viewer as unintelligent; pads runtime with no new information[^29] | One demonstration is more convincing than three verbal descriptions |
| **"We're excited to announce..."** | Meaningless opener; wastes the highest-attention moment | Start with the problem or product in action |
| **No pattern interrupts in long videos** | Attention drift is inevitable without re-engagement stimulus every 20–40s[^29] | Plan explicit pattern breaks — change shot, show metric, add motion text |
| **Feature montage (no story)** | Gives no context for why any feature matters | Narrative spine: problem → solution → proof → CTA |
| **Identical pace throughout** | Flat energy = flat engagement[^27] | Build and release: slow down on key moments, accelerate during transitions |

***

## Part VIII: Channel Typography and Pacing Quick Reference

### Platform-Specific Text Size and Pacing

| Channel | Safe Text Min Size | Ideal Cut Rate | Max Words/Frame | Voice Pace | Design Register |
|---|---|---|---|---|---|
| LinkedIn feed | 60px (vertical), 36px (16:9) | 15–25 cuts/min | 15 words | 140–160 WPM | Conversational, warm professional |
| YouTube (tutorial) | 36px (16:9) | 8–15 cuts/min | 20 words | 130–150 WPM | Deliberate, structured, technical |
| YouTube Shorts | 60px (9:16) | 25–40 cuts/min | 10 words | 160–180 WPM | Energetic, fast payoff |
| TikTok / Reels | 64px (9:16) | 30–60 cuts/min | 8 words | 150–175 WPM | Authentic, immediate, punchy |
| App Store preview | Apple rules apply | ~1 scene per 5–8s | Text overlays not allowed for submission | N/A (music/sound FX only) | Clean, product-forward |
| Website hero | 48px (16:9 desktop) | 6–12 cuts/min | 15 words | 130–150 WPM | Premium, confident, story-led |
| Product Hunt | 56px (1:1 or 16:9) | 15–25 cuts/min | 12 words | 150–170 WPM | Authentic, founder-energy |

***

## Part IX: Focus Depth — How Many Ideas Per Segment

One of the most common production errors is treating "information density" and "comprehension" as the same variable. They are not.

**The one-idea-per-scene rule:** Every distinct visual scene — a screen recording segment, a talking head clip, a motion graphic card — should deliver exactly one idea. When scenes try to do two or three things simultaneously, viewers typically absorb zero.[^33][^9]

**Practical application:**

For a 60-second AI agent demo, structure as:
- Scene 1 (0–5s): The problem — one sentence, one visual
- Scene 2 (5–15s): Agent trigger — one action shown, one outcome stated
- Scene 3 (15–30s): Two key features — each gets its own 5–7 second clip, back to back
- Scene 4 (30–45s): One proof point (metric or user quote) — nothing else on screen
- Scene 5 (45–60s): CTA — single action, single URL or button

For a 10-minute YouTube tutorial:
- Chapter structure: each chapter addresses one workflow step
- Within a chapter, max 2 concepts before a visual break (B-roll, screen recording segment, or title card)
- Use chapter markers in YouTube to let viewers navigate by specific idea — this respects cognitive load for the audience and helps the algorithm understand topical structure

**Focusing on one vs. two ideas:** One idea per frame is always correct for emotional/hook content (TOFU, social, App Store). Two ideas per frame is acceptable in tutorial or evaluation-stage demos *if and only if* the two ideas are tightly causally linked — "here's the input → here's the output." More than two ideas per frame, always split.

***

## Part X: Competing Schools — Where They Agree and Disagree

### The Great Debates

**1. How polished should software demos be?**

- **Wistia / Loom school:** Authenticity > polish. Real screen recordings with real workflows convert better than art-directed mockups because they reduce purchase anxiety ("will it really look like that?")
- **Apple / Linear school:** Polish *is* the product signal. A beautifully produced demo tells the viewer the team has taste and attention to detail, which correlates in buyers' minds with product quality.
- **Where they agree:** Never use Figma mockups or fake-feeling demos. Show real UI. The disagreement is only about how much art direction to add around the real UI.

**2. How fast should the pace be?**

- **YouTube growth school:** Cut faster. Every second of pause is a dropout risk. Algorithmic metrics (watch time, completion) reward density.
- **Editorial / cinematic school:** Pace should match the emotional beat of the content, not an algorithmic target. Rushed pacing in a product that requires trust can signal desperation.
- **Where they agree:** No dead air. Pauses are a design tool, not an accident. Both camps eliminate accidents.

**3. Should the VO match the on-screen text exactly?**

- **Accessibility school:** Yes — captions/subtitles should match VO for accessibility compliance and sound-off viewing.
- **Cognitive Load school:** No — research clearly shows verbatim on-screen text simultaneous with the same spoken words reduces comprehension and retention. The viewer splits visual attention between the text and the product.[^7][^6]
- **Resolution:** Captions (at the bottom, subtitle-style) are correct and necessary for accessibility. Full on-screen text overlays that replicate the VO are harmful. Keyword-only highlights that accent without duplicating are neutral-to-positive.

**4. Dark mode or light mode for maximum impact?**

- **Developer/AI school:** Dark mode. Always. It's what developers actually use, it makes color accents pop, and it signals "serious tech."
- **General product / enterprise school:** Light mode is more readable for longer-form content and feels more familiar to non-technical enterprise buyers.
- **Resolution:** Match the audience. If you're making developer tools for developers who live in dark IDEs, light mode will feel jarringly out of place. If you're making a B2B productivity tool for operations managers, dark mode may feel intimidating.

**5. How much voice personality should a VO have?**

- **Narrative/brand school:** Strong vocal personality = brand differentiation. The voice *is* part of the product experience.
- **Neutral efficiency school:** VO should be invisible — clear, fast, informative, not distracting. Personality should come from the product and script, not performance.
- **Where they agree:** Flat, robotic delivery is disqualifying for any audience. Minimum bar is natural human energy. Disagreement is only about how far beyond natural to push.

---

## References

1. [Feel Think Do Approach for Video Marketing - Engage Video Marketing](https://engagevideomarketing.com/feel-think-do-approach-for-video-marketing/) - In marketing good content strategy really comes from simply understanding the human that you're tryi...

2. [B2B Brand Color Psychology: What Colors Convert Best](https://www.acscreative.com/insights/the-psychology-behind-color-in-b2b-branding-what-actually-converts/) - Your B2B website has 50 milliseconds to make a first impression—and color psychology can boost conve...

3. [Color Psychology in B2B Marketing: Driving Conversions Through ...](https://www.endeavorb2b.com/blog/color-psychology-in-b2b-marketing/) - Color Psychology in B2B Marketing demonstrates how colors trigger emotions and associations that inf...

4. [The Psychology of Color in SaaS Branding: Why Blue Isn't Always ...](https://itbeesolution.com/the-psychology-of-color-in-saas-branding-why-blue-isnt-always-the-answer-for-trust/) - In this article, we'll explore the psychology of color in SaaS branding, why blue became the default...

5. [Color Psychology in Enterprise SaaS How Design Choices ...](https://viterank.com/blog/color-psychology-enterprise-saas-2026) - Learn how color psychology impacts enterprise SaaS design. Discover how colors influence trust perce...

6. [The modality and redundancy effects in multimedia learning ... - PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC6084336/) - The present study aimed to examine the modality and redundancy effects in multimedia learning in chi...

7. [[PDF] MULTIMEDIA LEARNING by Richard E. Mayer](https://www.jsu.edu/online/faculty/MULTIMEDIA%20LEARNING%20by%20Richard%20E.%20Mayer.pdf)

8. [[PDF] Cognitive Constraints on Multimedia Learning: When Presenting ...](https://www.csus.edu/cpns/epperson/_internal/_documents/courses/hist107/Mayer_Heiser_Lonn_2001.pdf)

9. [Is it not too redundant? When signaling overlap reduces extraneous ...](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2026.1795142/full) - The redundancy effect in Cognitive Load Theory posits that presenting overlapping information across...

10. [How many words should I include in my 60-second video?](https://www.youtube.com/watch?v=gt4L2tnHxP0) - Find out exactly how many words to include in 60-seconds of video, both spoken and written. Haily ta...

11. [Rules for text in videos](https://legibility.info/rules-for-text-in-videos) - In general terms, the rules already outlined above also apply to animated videos with text, text ove...

12. [Using Text Overlays and Annotations to Enhance Your Screen ...](https://recorded.app/en/blog/text-overlays-and-annotations/) - Learn how to enhance your screen recordings with text overlays and annotations. Add titles, callouts...

13. [How much text is too much text on a single CPD presentation slide?](https://www.frakt-consultants.com/docs/how-much-text-is-too-much-text-on-a-single-cpd-presentation-slide/) - Too much text occurs when a slide exceeds 40 words or mirrors the spoken script, triggering "redunda...

14. [12 Best Practices for Video: Limit Text on Slides](https://www.youtube.com/watch?v=vJZO4tE09W8) - Tips for using slides on a video call or presentation (hint: keep it simple).

15. [Too Much Text on Those Slides - SIUE](https://www.siue.edu/sites/midweek-mentor/pages/2014/slides.shtml)

16. [Social Media Safe Zones: Full Guide for Creators (2026)](https://postplanify.com/blog/social-media-safe-zones-2026-complete-guide) - TikTok, Instagram Reels, and YouTube Shorts safe zones with exact pixel specs, device variations, an...

17. [Social Media Aspect Ratios & Safe Zones Guide 2026](https://www.trymypost.com/blog/platform-aspect-ratios-safe-zones-2026) - Master 2026 social media aspect ratios and safe zones. Get exact pixel dimensions for Instagram, Tik...

18. [How to Make a (Good) Kinetic Typography Animation Video](https://www.nyfa.edu/student-resources/make-good-kinetic-typography-animation-video/) - Kinetic typography is a fantastically engaging way of delivering text information in a visual way. I...

19. [Typography in Motion: 7 Design Principles - Upskillist](https://www.upskillist.com/blog/typography-in-motion-7-design-principles/) - Explore seven essential principles of kinetic typography to create engaging animated text that captu...

20. [Kinetic Typography - How to make it fast and clean](https://www.reddit.com/r/MotionDesign/comments/34qu4k/kinetic_typography_how_to_make_it_fast_and_clean/) - Kinetic Typography - How to make it fast and clean

21. [How to Choose Music for New Product Videos](https://closermusic.com/blog/How-to-Choose-Music-for-New-Product-Videos) - Music shapes the viewer's first impression before the product has been fully explained, influencing ...

22. [Words Per Minute in Voice Over: Find Your Ideal Speaking ...](https://www.worldvoiceovers.com/blog/words-per-minute-in-voice-over) - Wondering how words per minute (WPM) affects your voice over work? Discover the ideal pacing for var...

23. [Free Script Timer — Time Your Script Read Live | VoiceDeck](https://voicedeck.io/tools/script-timer/) - Time your script read live. Paste a script, pick a speaking pace and start the timer — see your esti...

24. [Voice Over Script Timer Calculator](https://lanceblairvo.com/voiceover-script-timer/) - Wondering how long your voiceover script will take? The Script Timer Voiceover Calculator provides a...

25. [#voiceover #videoproduction #voiceactor | Tanya Rich | 18 comments](https://www.linkedin.com/posts/tanya-rich-voiceover_voiceover-videoproduction-voiceactor-activity-7262758745963745280-gWGB) - IfIwritelikethiscanyoureaditeasilyenough? Ordoesitmakeitmoredifficulttounderstand? Agreed. It's too ...

26. [Speech Pace Calculator 2025 | Words Per Minute Analyzer](https://aiaudioexpert.com/tools/speech-pace) - Professional speech pace calculator to analyze words per minute (WPM) for podcasts, YouTube videos, ...

27. [AI Editing Mistakes That Kill Engagement in 2026 (and How to Fix Them)](https://www.youtube.com/watch?v=hw_-3q-5XiY) - If your AI videos are not getting views, your editing is the REAL problem.
Here are the biggest AI e...

28. [How to Choose the Right AI Voiceover Speed and Tone for Different ...](https://channel.farm/blog/how-to-choose-ai-voiceover-speed-tone-youtube-video-genres) - Learn how to match AI voiceover speed and tone to your YouTube video genre. Practical settings for e...

29. [Editing Mistakes Killing Your Watch Time (And How to Fix Them)](https://www.youtube.com/watch?v=SgeXLYQ3kiA) - 00:00 – 00:06
🔥 Hook
Why people are clicking off (editing, not content)

00:06 – 00:35

🎯 Set the Pr...

30. [Video Length and Number of Cuts | 5 Concepts for Easy-to- ...](https://note.com/tomoya0318/n/n9c33cb9ca8ed?hl=en) - Do you think the reason your short videos aren't growing is because you "lack sense" or "are bad at ...

31. [TikTok 3-Second Rule: Jump Cut Timing That Hooks - Blitzcut](https://blitzcutai.com/blog/3-second-rule-tiktok-jump-cuts) - Viewers decide to stay or swipe within 3 seconds. Data shows jump cuts every 3-4 seconds boost TikTo...

32. [3 tips to improve text heavy slides | PowerPoint presentation tips](https://www.youtube.com/watch?v=ep648UOCJx4) - One of the most common mistakes we see in PowerPoint presentations is that there is too much text.

...

33. [[PDF] Nine Ways to Reduce Cognitive Load in Multimedia Learning](https://www.uky.edu/~gmswan3/544/9_ways_to_reduce_CL.pdf)

34. [Advanced retention editing: cutting strategies to keep viewers ...](https://air.io/en/youtube-hacks/advanced-retention-editing-cutting-patterns-that-keep-viewers-past-minute-8) - Learn pro editing techniques that maximize retention and keep your viewers engaged long past the dro...

35. [Video Editing Tips for Better YouTube Retention (2026)](https://instantviews.net/video-editing-tips-retention) - Learn proven video editing techniques that boost retention rates. Master pacing, cuts, and engagemen...

36. [Apple: Minimalist Storytelling and Product Experience Marketing ...](https://entri.app/blog/apple-minimalists-storytelling-marketing-strategy/) - Discover how Apple's marketing strategy focusing on minimalist storytelling and product experience r...

37. [Lo-Fi Video Strategy: Why iPhone Videos Beat Big Ads (E-E-A-T)](https://creatives.me/2025/11/15/why-your-lo-fi-iphone-video-will-beat-your-50k-ad-creative-in-2026/) - A lo-fi video strategy (using raw, authentic iPhone footage) will beat a $50k ad in 2026. Learn how ...

38. [The Authenticity Era: Why Raw Video Often Outperforms ...](https://your.film/learn/insights/authenticity-era-raw-video-vs-polished-content-2026/) - In 2026, raw video often outperforms polished content because audiences value trust, transparency an...

39. [200+ Must-Know Social Media Video Statistics - Zebracat AI](https://www.zebracat.ai/post/social-media-video-statistics) - Feel like your videos aren't landing? These 200+ must-know social media stats show what's working in...
</content>
