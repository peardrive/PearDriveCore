/*!
 * Copyright (C) 2025 Jenna Baudelaire
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * @remarks Converts a string to a drive path for hyperdrive entry.
 *
 * @protected
 */

/** Convery string to a drive path for a hyperdrive entry */
export function asDrivePath(str) {
  return str.startsWith("/") ? str : `/${str}`;
}
