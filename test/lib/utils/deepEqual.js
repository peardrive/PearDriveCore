/**
 * Deeply compare two objects (or arrays, primitives) to ensure
 * every key-value pair matches.
 *
 * @param {any}
 * @param {any} b
 * @returns {boolean}
 */
export function deepEqual(a, b) {
  // Handle reference equality & primitives
  if (a === b) return true;

  // Handle NaN (since NaN !== NaN)
  if (typeof a === "number" && typeof b === "number" && isNaN(a) && isNaN(b)) {
    return true;
  }

  // If types differ → fail
  if (typeof a !== typeof b) return false;

  // Handle Arrays
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((val, idx) => deepEqual(val, b[idx]));
  }

  // Handle Objects
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);

    if (keysA.length !== keysB.length) return false;

    return keysA.every((key) => deepEqual(a[key], b[key]));
  }

  // Fallback: primitives (string, number, boolean, null, undefined, symbol)
  return false;
}
