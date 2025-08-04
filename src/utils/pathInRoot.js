import process from "process";

/** Determine whether a path is within the root of the Sister process */
export function pathInRoot(path) {
  return path.startsWith(process.cwd());
}
