/**
 * Test object equality
 *
 * @param {Object} obj1
 * @param {Object} obj2
 *
 * @returns {boolean} - true if objects are equal, false otherwise
 */
export function areObjectsEqual(obj1, obj2) {
  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);

  // Check if the number of keys is the same
  if (keys1.length !== keys2.length) return false;

  // Check if all keys and values are equal
  for (const key of keys1) {
    if (!obj2.hasOwnProperty(key) || obj1[key] !== obj2[key]) {
      return false;
    }
  }

  return true;
}
