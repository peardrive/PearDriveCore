/*!
 * Copyright (C) 2025 PearDrive
 * Copyright (C) 2025 Jenna Baudelaire
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * @remarks Determines whether a given path is within the root of the PearDrive
 *  process.
 *
 * @protected
 */

import process from "process";

/** Determine whether a path is within the root of the PearDrive process
 *
 * @param {string} path - The path to check
 *
 * @return {boolean} - True if the path is within the root, false otherwise
 *
 * @protected
 */
export function pathInRoot(path) {
  return path.startsWith(process.cwd());
}
