import crypto from "hypercore-crypto";

/**
 * Generate a seed for hyperswarm keypair or topic
 *
 * @returns {Uint8Array | ArrayBuffer} seed
 */
export function generateSeed() {
  return crypto.randomBytes(32);
}
