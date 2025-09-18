import fs from "fs";

/**
 * Make sure a folder exists at the given absolute path
 *
 * @param {string} absolutePath - The absolute path to the folder
 */
export function ensureFolderExists(absolutePath) {
  try {
    fs.mkdirSync(absolutePath, { recursive: true });
  } catch (error) {
    console.error("Error creating folder", absolutePath, error);
  }
}
