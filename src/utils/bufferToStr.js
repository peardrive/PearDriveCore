import b4a from "b4a";

/**
 * Array buffer to string (Only use when necessary!)
 *
 * @param {Uint8Array | ArrayBuffer} buffer key buffer
 *
 * @returns {string} Stringified version of key
 */
export function bufferToStr(buffer) {
  return b4a.toString(buffer, "hex");
}
