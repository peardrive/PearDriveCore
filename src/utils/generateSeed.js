/*!
 * Copyright (C) 2025 PearDrive
 * Copyright (C) 2025 Jenna Baudelaire
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * @remarks Generates a random seed for hyperswarm keypair or topic.
 */

import crypto from "hypercore-crypto";

/**
 * Generate a seed for hyperswarm keypair or topic
 *
 * @returns {Uint8Array | ArrayBuffer} seed
 */
export function generateSeed() {
  return crypto.randomBytes(32);
}
