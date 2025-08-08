/*!
 * Copyright (C) 2025 Jenna Baudelaire
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * @remarks Create absolute path from relative path and base directory
 *
 * @protected
 */

import path from "path";

/**
 * Create absolute path from relative path and base directory
 *
 * @param {string} relativePath - The relative path to convert
 * @param {string} baseDir - The base directory to resolve against
 *
 * @return {string} The absolute path
 */
export function createAbsPath(relativePath, baseDir) {
  // Normalize the base directory
  const normalizedBaseDir = path.resolve(baseDir);

  // Resolve the relative path against the base directory
  const absPath = path.resolve(normalizedBaseDir, relativePath);

  // Return the absolute path
  return absPath;
}
