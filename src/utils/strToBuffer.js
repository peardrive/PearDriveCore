/*!
 * Copyright (C) 2025 Jenna Baudelaire
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * @remarks String to array buffer (Only use when necessary!)
 *
 * @protected
 */

import b4a from "b4a";

/**
 * String to array buffer (Only use when necessary!)
 *
 * @param {string} str Stringified version of key
 *
 * @returns {Uint8Array | ArrayBuffer} key buffer
 *
 * @protected
 */
export function strToBuffer(str) {
  return b4a.from(str, "hex");
}
