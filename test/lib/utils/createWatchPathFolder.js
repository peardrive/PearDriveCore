import fs from "fs";
import path from "path";

import { createRandomFile } from "./createRandomFile.js";

/**
 * Create a localdrive folder
 *
 * @param {string} folderName - The name of the folder to create
 *
 * @returns {string} - The full path to the created folder
 */
export function createWatchPathFolder(folderName) {
  const folderPath = path.join(Ctest.LD_DIR, folderName);
  fs.mkdirSync(folderPath, { recursive: true });

  let files = [];
  for (let i = 0; i < 3; i++) {
    const file = createRandomFile(folderPath);
    files.push(file);
  }
  return folderPath;
}
