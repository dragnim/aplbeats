import { REST, type Phrase } from '@/tones/phrase';

/*
 * The two phrases every candidate is heard with, and nothing else.
 *
 * Fixed, so the only thing that changes between candidates is the sound. No randomness, no
 * generation, no APL — a bench where the notes moved would be a bench that could not answer the
 * question it exists for.
 *
 * **This is not a production change.** The opening phrase below is exactly the one the application
 * ships, imported in spirit rather than in code so that the bench's copy cannot drift into an
 * "improvement". If it turns out that every good patch still sounds bad here, that is evidence
 * about the phrase — and evidence is what this is for.
 */

/**
 * The phrase APL Beats opens on: six notes in sixteen steps, C minor pentatonic.
 *
 * C4 · · E♭4 · G4 · · F4 · · E♭4 · C4 · ·
 *
 * Sparse, and it rests on 5 and 13 where the backbeat is. Because a note now rings through the
 * rests after it, the longest any note holds here is three steps — 402 ms at 112 BPM — which is
 * worth knowing before blaming the 1.2-second trim for a pad that will not bloom.
 */
export const OPENING_PHRASE: Phrase = [
  60,
  REST,
  REST,
  63,
  REST,
  67,
  REST,
  REST,
  65,
  REST,
  REST,
  63,
  REST,
  60,
  REST,
  REST,
];

/**
 * A denser reference: eleven notes, stepwise movement, the same scale.
 *
 * The opening phrase answers "does this sound good when it has room?". This answers the other
 * question — "does it still articulate when it is actually being sequenced?" — which is where a
 * slow attack stops being lush and starts being mush, and where a bright lead stops being present
 * and starts being tiring.
 *
 * Still C minor pentatonic, still no randomness, and deliberately not a tune anybody would ship:
 * it is a test signal made of notes. The longest hold is two steps, the shortest one.
 */
export const DENSE_PHRASE: Phrase = [60, 63, 65, 63, 67, REST, 65, 63, 60, 63, 65, 67, 70, REST, 67, 65];

export const AUDITION_PHRASES = [
  {
    id: 'opening',
    name: 'Opening phrase',
    phrase: OPENING_PHRASE,
    note: 'What the application ships. Sparse: six notes, longest hold three steps.',
  },
  {
    id: 'dense',
    name: 'Dense reference',
    phrase: DENSE_PHRASE,
    note: 'Eleven notes with stepwise movement. Longest hold two steps.',
  },
] as const;

export type AuditionPhraseId = (typeof AUDITION_PHRASES)[number]['id'];
