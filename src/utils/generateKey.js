/*!
 * Copyright (C) 2025 PearDrive LLC
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * @remarks Generates a random key for hypercores.
 */

import crypto from "hypercore-crypto";

/**
 * Generate a key for hypercores
 *
 * @returns {Uint8Array | ArrayBuffer} seed
 */
export function generateKey() {
  return crypto.randomBytes(32);
}
