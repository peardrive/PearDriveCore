import path from "path";

/**
 * Convert a raw absolute path to a path that will be properly handled by
 * localdrive and watch-drive
 *
 * @param {String} inputPath - Absolute path to localdrive
 * @param {String} root - Root path of project
 *
 * @returns {String} LocalDrive path
 */
export function formatLocalDrivePath(inputPath, root) {
  // Normalize root and input paths
  const normalizedRoot = path.resolve(root);
  const normalizedInput = path.resolve(inputPath);

  // If the input path is absolute AND outside the root, return it as-is
  if (
    path.isAbsolute(inputPath) &&
    !normalizedInput.startsWith(normalizedRoot)
  ) {
    return normalizedInput;
  }

  // Otherwise, let localdrive handle it normally (it assumes relative paths)
  return path.resolve(normalizedRoot, inputPath);
}
