export function createContinuityValidationGate() {
  let epoch = 0;

  return Object.freeze({
    invalidate() {
      epoch += 1;
      return epoch;
    },
    snapshot() {
      return epoch;
    },
    isCurrent(candidate) {
      return Number.isSafeInteger(candidate) && candidate === epoch;
    },
  });
}
