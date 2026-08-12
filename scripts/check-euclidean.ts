/*
 * Is `k>16|k×⍳16` the same rhythm as Bjorklund's algorithm?
 *
 * The brief suggested that expression for the Euclidean operation and was explicit that it
 * should not be accepted merely because it looks elegant. Stage 2 already contains a
 * verified Bjorklund implementation, so the two can be compared exhaustively here — in
 * TypeScript, at no cost to TryAPL — for every pulse count and every rotation.
 *
 * Reported as: identical, identical after some rotation, or genuinely different.
 */

import { euclideanPattern, rotate } from '@/generation/euclidean';

const STEPS = 16;

/** `k>16|k×⍳16` with ⎕IO←0, in TypeScript. */
function multiplicative(pulses: number): boolean[] {
  return Array.from({ length: STEPS }, (_unused, index) => (pulses * index) % STEPS < pulses);
}

function show(pattern: readonly boolean[]): string {
  return pattern.map((on) => (on ? '1' : '0')).join('');
}

console.log('k   k>16|k×⍳16        Bjorklund E(k,16)  relationship');
console.log('-----------------------------------------------------------------');

const rotations = new Map<number, number>();
let allRotationEquivalent = true;

for (let pulses = 0; pulses <= STEPS; pulses += 1) {
  const formula = multiplicative(pulses);
  const bjorklund = euclideanPattern(pulses, STEPS);

  let relationship = 'DIFFERENT';
  if (show(formula) === show(bjorklund)) {
    relationship = 'identical';
    rotations.set(pulses, 0);
  } else {
    for (let by = 1; by < STEPS; by += 1) {
      if (show(rotate(bjorklund, by)) === show(formula)) {
        relationship = `Bjorklund rotated left by ${String(by)}`;
        rotations.set(pulses, by);
        break;
      }
    }
    if (!rotations.has(pulses)) allRotationEquivalent = false;
  }

  console.log(`${String(pulses).padStart(2)}  ${show(formula)}  ${show(bjorklund)}   ${relationship}`);
}

console.log('');
console.log(
  allRotationEquivalent
    ? 'Every pulse count is Bjorklund up to a rotation.'
    : 'At least one pulse count is NOT a rotation of Bjorklund.',
);

/* ---- does the same hold once a rotation is applied? ---------------------- */

let rotationConsistent = true;
for (let pulses = 0; pulses <= STEPS; pulses += 1) {
  const offset = rotations.get(pulses);
  if (offset === undefined) continue;

  for (let by = 0; by < STEPS; by += 1) {
    const formulaRotated = rotate(multiplicative(pulses), by);
    const bjorklundRotated = rotate(euclideanPattern(pulses, STEPS), by + offset);
    if (show(formulaRotated) !== show(bjorklundRotated)) {
      console.log(`  mismatch at pulses ${String(pulses)} rotation ${String(by)}`);
      rotationConsistent = false;
    }
  }
}

console.log(
  rotationConsistent
    ? 'The relationship is a fixed offset per pulse count: rotating either form by the same amount keeps them equal.'
    : 'The relationship is NOT a fixed offset.',
);

/* ---- how even is it, really? -------------------------------------------- */

console.log('');
console.log('Gap structure (the property that makes a rhythm "Euclidean"):');
for (const pulses of [3, 5, 7, 9, 11]) {
  const steps: number[] = [];
  multiplicative(pulses).forEach((on, index) => {
    if (on) steps.push(index);
  });

  const gaps = steps.map((step, index) =>
    index === steps.length - 1 ? STEPS - step + (steps[0] ?? 0) : (steps[index + 1] ?? 0) - step,
  );
  const distinct = [...new Set(gaps)].sort((a, b) => a - b);
  console.log(
    `  k=${String(pulses).padStart(2)}  steps ${steps.join(',').padEnd(26)} gaps ${gaps.join(',').padEnd(24)} distinct ${distinct.join('/')}`,
  );
}
