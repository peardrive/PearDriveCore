/**
 * Determine whether environment is Pear runtime
 *
 * @returns {boolean} Whether environment is Pear runtime
 */
export function isPearRuntime() {
  return typeof Pear !== "undefined";
}
