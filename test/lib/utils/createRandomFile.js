import fs from "fs";

import { generateString } from "./generateString.js";

/**
 * Create a random dummy text file in given basePath
 *
 * @param {string} basePath - The directory where the file will be created
 * @param {number} length - Length of random string for file contents
 *
 * @returns {object} - Object containing name, path, and contents of the created
 * file
 */
export function createRandomFile(basePath, length = 8) {
  const name = `${generateString(8)}.txt`;
  const path = `${basePath}/${name}`;
  const contents = generateString(length);

  fs.writeFileSync(path, contents);
  return {
    name,
    path,
    contents,
  };
}
