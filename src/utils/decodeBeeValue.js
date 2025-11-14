/*!
 * Copyright (C) 2025 PearDrive LLC
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** Decode a Hyperbee value */
export function decodeBeeValue(value) {
  try {
    // If value is an object, return it as-is
    if (
      value &&
      typeof value !== "string" &&
      !Buffer.isBuffer(value) &&
      typeof value === "object"
    ) {
      return value;
    }

    const str = Buffer.isBuffer(value)
      ? value.toString("utf8")
      : String(value ?? "");
    return str ? JSON.parse(str) : null;
  } catch (error) {
    return null;
  }
}
