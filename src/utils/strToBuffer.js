import b4a from "b4a";

/**
 * String to array buffer (Only use when necessary!)
 *
 * @param {string} str Stringified version of key
 *
 * @returns {Uint8Array | ArrayBuffer} key buffer
 */
export function strToBuffer(str) {
  return b4a.from(str, "hex");
}
