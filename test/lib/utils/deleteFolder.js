import fs from "fs";

/**
 * Delete folder
 *
 * @param {string} absolutePath - The absolute path to the folder
 */
export function deleteFolder(absolutePath) {
  fs.rmSync(absolutePath, { recursive: true });
}
