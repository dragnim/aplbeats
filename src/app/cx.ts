/**
 * Join class names, dropping anything falsy.
 *
 * A dozen lines instead of a dependency. Conditional classes are the only thing
 * this application needs from the several kilobytes a class-name library would add.
 */
export function cx(...values: (string | false | null | undefined)[]): string {
  let result = '';
  for (const value of values) {
    if (!value) continue;
    result = result === '' ? value : `${result} ${value}`;
  }
  return result;
}
