/*!
 * Copyright (C) 2025 PearDrive
 * Copyright (C) 2025 Jenna Baudelaire
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * @remarks Array buffer to string (Only use when necessary!)
 *
 * @protected
 */

import b4a from "b4a";

/**
 * Array buffer to string (Only use when necessary!)
 *
 * @param {Uint8Array | ArrayBuffer} buffer key buffer
 *
 * @returns {string} Stringified version of key
 *
 * @protected
 */
export function bufferToStr(buffer) {
  return b4a.toString(buffer, "hex");
}
