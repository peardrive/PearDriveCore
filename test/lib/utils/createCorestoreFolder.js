import path from "path";
import fs from "fs";

import * as CTEST from "../constants.js";

/**
 * Create a corestore folder
 *
 * @param {string} folderName - The name of the folder to create
 *
 * @returns {string} - The full path to the created folder
 */
export function createCorestoreFolder(folderName) {
  const folderPath = path.join(CTEST.CORESTORE_DIR, folderName);
  fs.mkdirSync(folderPath, { recursive: true });

  return folderPath;
}
