import path from "path";

import { generateString } from "./generateString.js";

/**
 * Create a new random folder in a given basePath
 *
 * @param {string} basePath - The base directory where the new folder will be
 * created
 * @param {number} length - Length of random string for folder name
 *
 * @returns {string} - The full path of the newly created folder
 */
export function createNewFolderPath(basePath, length = 8) {
  return path.join(basePath, generateString(length));
}
