# Third-party notices

Work by others that APL Beats includes, and the terms it is used under. This file is
documentation: nothing here is shown inside the application.

## Audio

**None.** There is no third-party audio in this repository, and no audio of any kind.

Every sound APL Beats makes is synthesised in the browser at the moment it is played,
by the code in [`src/audio/kit.ts`](src/audio/kit.ts). No sample is bundled, no sample
is fetched, and nothing is streamed from anywhere during playback.

That was a deliberate decision rather than a convenient one. A public repository should
not carry audio whose licence anyone has to take on trust, and the practical work of
establishing provenance for a percussion kit — who recorded it, on what, under which
version of which licence, and whether the person who uploaded it had the right to —
is not work that can be done honestly in an afternoon. Synthesis avoids the question
entirely: the sounds are original, they weigh nothing, and they are parameters rather
than recordings, which is the form a later release can open up to editing.

The voices are modelled on how the instruments they are named after behave, and on the
published designs of the classic drum machines — a pitch-swept sine for the kick, a
bank of square waves at inharmonic ratios through a narrow high band for the hats,
overlapping noise bursts for the clap. Those are techniques, not recordings, and no
audio from any machine is reproduced.

Sound design remains provisional and is expected to be revisited. If a properly
licensed kit is ever introduced, it will arrive through the `Kit` interface in
`src/audio/kit.ts` and be recorded here with its licence, its source and its author.

## Code

The dependencies are listed in [`package.json`](package.json) and their licences travel
with them in `node_modules`; none is vendored into this repository. React and Vite are
MIT-licensed, as is everything else in the build.

## Typography

The interface asks for whatever grotesque the device already has, through the `system-ui`
stack in [`src/styles/tokens.css`](src/styles/tokens.css). One font is bundled, and only
for the APL.

**APL387**, Dyalog's redrawn successor to Adrian Smith's APL385 Unicode.

- Source: <https://github.com/Dyalog/APL387>
- Licence: **public domain**, released under [The Unlicence](https://unlicense.org/), which
  places no condition on redistribution.
- Bundled as: [`src/assets/fonts/APL387-subset.woff2`](src/assets/fonts/APL387-subset.woff2),
  23 KB.

The upstream repository does not commit a built TTF — it is produced by their CI and
published to their Pages site. [`scripts/subset-font.py`](scripts/subset-font.py) fetches it
from there and subsets it to the Unicode blocks APL glyphs live in, which it lists; the
resulting WOFF2 is committed, so contributors never need to run it. Re-run it only to pick
up an upstream revision.

A web font was avoided for Stages 1 and 2 and is here now for one reason: `⍴`, `⌽`, `⍳` and
`¯` render at inconsistent widths, or not at all, in the monospace fonts most systems
supply, and Peek exists to show APL as APL is written. A licence that permits
redistribution without condition made bundling the honest option — the alternatives were
fetching from someone else's CDN at runtime, which this application does not do, or hoping
the visitor already had the font, which most do not.

Loaded with `font-display: swap` and falling back to the platform monospace, so the
interface is legible before it arrives and remains legible if it never does.
