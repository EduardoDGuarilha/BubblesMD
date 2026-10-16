# Bubbles.MD visual and interaction design

Status: design contract and historical references, not a verified app. This file owns visual requirements; implementation defaults can be adjusted for readability while preserving the selected experience.

Read/open `design/reference/left-layout-study.html`. It is a static design study with local demonstration controls, not application code or proof of editor behavior. The Paint concepts `design/reference/thought-bubble-concept.png` and `design/reference/minimized-bubble-concept.png`, if present, explain the bubble relationship. Do not copy their StackEdit branding or two-pane editor.

**Overrides to every reference:** only one writing representation is visible at a time; all minimized markers belong on the **right**; the first reflection submits with Enter; the initial state has no Suggest button; a dedicated Repair button is excluded from this delivery. Study buttons that are disabled or illustrative must become real controls only where this contract specifies them. Do not copy fixed coordinates or the sketch's state logic into the app.

| Element | Implement this |
| --- | --- |
| Fresh opening | Bubbles.MD title, one pleasing create-document bubble, and one clickable file/drop area. No dashboard or onboarding wizard. Returning saved work restores the editor. |
| Canvas | Stable writing column toward the left, generous space on the right for reviews. Opening a review must not recenter or narrow the prose. |
| Desktop geometry | Starting defaults: 32–48 px outer space, 28–40 px document/review gap, readable prose around 58–68 characters per line. At roomy widths allow roughly 380–560 px for an expanded candidate; adapt to measured bounds. Values are starting points, not fixed screen coordinates. |
| Appearance | Quiet paper surface, dark readable text, restrained toolbar, warm softly tinted thought bubbles with thin amber outlines. The study's white/cream, charcoal, and amber palette is the baseline; no broad rebranding or unrelated gradients/cards. Use system fonts, body approximately 16 px with 1.6–1.75 line height. |
| Bubble family | One main candidate bubble with generous rounded edges, smaller reflection bubbles attached using small circular thought connectors, and a + for another reflection. Preserve a floating relationship rather than a rigid sidebar chat list. |
| Candidate contents | Only the replacement for the selection, including an incomplete sentence when that is what was selected. Do not repeat the original in another text block or silently expand the scope to a paragraph. |
| Source changes | Green insertion + at a position; yellow outlined/tinted original wording for an alteration; red outlined/tinted original wording for a deletion. Keep letters readable. No nested bubble outlines inside the candidate. |
| Candidate changes | Simple green/yellow emphasis on inserted/replacement text; removed text stays visible in the original. Hover/focus pairs both sides, including insertion/deletion positions, with Added/Altered/Deleted labels. |
| Minimized state | Neutral compact … bubbles on the right near their targets. Hide colored source-change decorations for minimized reviews. Multiple markers must remain distinguishable and clickable. |
| Long/edge cases | Measure sizes and resolve collisions within review space. Bound a long candidate to available viewport height with reachable scrolling/actions; let attached thoughts remain reachable. Never cover the original with an oversized bubble. |
| Source offscreen | Preserve the review, stop drawing a misleading connector, and show a small Back to passage control. User activation scrolls to its actual target. Do not silently jump the document. |
| Narrow screens | Stack the active review after the writing surface when two columns no longer fit. Preserve explicit source navigation; do not squeeze prose into a tiny column. Desktop is the primary assessment view, but controls must remain usable. |
| Feedback | Soft, short pop sound for deliberate popping; one sound for a whole branch. Outside-click minimization stays quiet. Include mute, reduced-motion handling, visible focus, and keyboard equivalents. No sound library/service is required. |

Inspect the real application at desktop widths such as 1440 and 1024, plus a narrow width such as 390. Check a long multi-paragraph selection, three reflections, nearby minimized reviews, wrapping changes, resizing, scrolling, and the source leaving view. Screenshots must show real editor content and controls. The study is a reference, not visual acceptance of the future app.

Reference links: [HTML study](design/reference/left-layout-study.html), [thought-bubble concept](design/reference/thought-bubble-concept.png), [minimized-bubble concept](design/reference/minimized-bubble-concept.png).
