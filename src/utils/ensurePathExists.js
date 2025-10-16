/*!
 * Copyright (C) 2025 PearDrive
 * Copyright (C) 2025 Jenna Baudelaire
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * @remarks Create directory path if it doesn't exist
 *
 * @protected
 */

import fs from "fs";

/**
 * Create directory path if it doesn't exist
 *
 * @param {string} dirPath - The directory path to ensure exists
 *
 * @returns {boolean} - True if the path already exists, false if it was just
 * created
 */
export function ensurePathExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    return false;
  }
  return true;
}
