/*!
 * Copyright (C) 2025 PearDrive LLC
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * @remarks Converts a string to a drive path for hyperdrive entry.
 *
 * @protected
 */

/** Convert string to a drive path for a hyperdrive entry */
export function asDrivePath(str) {
  return str.startsWith("/") ? str : `/${str}`;
}
