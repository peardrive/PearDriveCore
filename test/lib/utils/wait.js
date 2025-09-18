/**
 * Wait for n seconds
 *
 * @param {number} n - Number of seconds to wait
 *
 * @returns {Promise} - Resolves after n seconds
 */
export function wait(n = 1) {
  return new Promise((resolve) => setTimeout(resolve, n * 1000));
}
