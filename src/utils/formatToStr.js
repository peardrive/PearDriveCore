/*!
 * Copyright (C) 2025 PearDrive LLC
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * @remarks Take key of string or buffer, format to string (Only use when
 *  necessary!)
 */

import * as utils from "./index.js";

/**
 * Take key of string or buffer, format to string (Only use when necessary!)
 *
 * @param {string | Uint8Array | ArrayBuffer} key key to format
 *
 * @returns {string} stringified key
 */
export function formatToStr(key) {
  if (typeof key === "string") return key;
  else if (key instanceof Uint8Array || key instanceof ArrayBuffer)
    return utils.bufferToStr(key);
  else throw new Error("Invalid key type", typeof key, key);
}
