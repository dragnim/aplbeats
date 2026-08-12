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

No web font is downloaded. The interface asks for whatever grotesque the device already
has, through the `system-ui` stack in
[`src/styles/tokens.css`](src/styles/tokens.css).
