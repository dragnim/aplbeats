/**
 * The generator's version.
 *
 * Part of the identity of a groove, alongside the seed. Tuning the weights changes what
 * a seed *means*, so a stored or shared pattern has to record which generator produced
 * it — otherwise restoring a session would silently play something else and blame the
 * seed. Persisted state from a different version is discarded rather than regenerated.
 *
 * On its own in a file with nothing else in it, because everything from the generator to
 * the seed streams to the persistence layer needs it and none of them should have to
 * import each other to get it.
 */
export const GENERATOR_VERSION = 1;
