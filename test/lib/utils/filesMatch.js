/**
 * Given two lists of files, ensure file.name and file.hash match for each of them
 */
export function filesMatch(files, expectedFiles) {
  if (files.length !== expectedFiles.length) {
    return false;
  }
  const fileMap = new Map(files.map((f) => [f.name, f.hash]));
  for (const file of expectedFiles) {
    if (!fileMap.has(file.name) || fileMap.get(file.name) !== file.hash) {
      return false;
    }
  }

  return true;
}
