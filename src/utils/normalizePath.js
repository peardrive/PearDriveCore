/*!
 * Copyright (C) 2025 PearDrive LLC
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * @remarks Normalizes a path to ensure it works on all platforms and will
 *  resolve correctly.
 */

import path from "path";

/**
 * Normalizes a path to ensure it is in the correct format and will resolve
 * correctly.
 *
 * @param {string} path - Path to normalize
 *
 * @returns {string} - Normalized path
 */
export function normalizePath(pathStr) {
  if (typeof pathStr !== "string") return pathStr;

  let normalizedPath = pathStr.trim();
  normalizedPath = path.normalize(normalizedPath);

  return normalizedPath;
}
