/*!
 * Copyright (C) 2025 PearDrive LLC
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * @remarks Determines whether the current environment is a Pear runtime.
 */

/**
 * Determine whether environment is Pear runtime
 *
 * @returns {boolean} Whether environment is Pear runtime
 */
export function isPearRuntime() {
  return typeof Pear !== "undefined";
}
