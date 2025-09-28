/**
 * Wait for condition to be true
 *
 * @param {Function} conditionFn - Function that returns true when condition is
 *   met
 * @param {number} [timeout=5000] - Maximum time to wait in milliseconds
 * @param {number} [interval=100] - Interval to check condition in milliseconds
 */
export async function waitFor(conditionFn, timeout = 5000, interval = 10) {
  const timeoutDate = Date.now() + timeout;

  // Check condition immediately
  if (await conditionFn()) return true;

  // Poll at regular intervals
  while (Date.now() < timeoutDate) {
    await new Promise((resolve) => setTimeout(resolve, interval));
    if (await conditionFn()) return true;
  }

  return false;
}
