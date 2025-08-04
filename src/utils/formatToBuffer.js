import * as utils from "./index.js";

/**
 * Take key of string or buffer, format to buffer (Only use when necessary!)
 *
 * @param {string | Uint8Array | ArrayBuffer} key key to format
 *
 * @returns {Uint8Array | ArrayBuffer} buffer key
 */
export function formatToBuffer(key) {
  if (typeof key === "string") return utils.strToBuffer(key);
  else if (key instanceof Uint8Array || key instanceof ArrayBuffer) return key;
  else throw new Error("Invalid key type", typeof key, key);
}
