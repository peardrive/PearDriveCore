/*!
 * Copyright (C) 2025 PearDrive
 * Copyright (C) 2025 Jenna Baudelaire
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * @remarks Creates / ensures existence of parent folders for a file path.
 *
 * @protected
 */

import fs from "fs";
import path from "path";

/** Create parent folder for a file path */
export function createParentFolder(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}
