import fs from "fs";

import * as CTEST from "../constants.js";

/** Create test folders if they don't exist */
export function createTestFolders() {
  if (!fs.existsSync(CTEST.TEST_MOCK_DATA_DIR))
    fs.mkdirSync(CTEST.TEST_MOCK_DATA_DIR);
  if (!fs.existsSync(CTEST.LD_DIR)) fs.mkdirSync(CTEST.WATCHPATH_DIR);
  if (!fs.existsSync(CTEST.CORESTORE_DIR)) fs.mkdirSync(CTEST.CORESTORE_DIR);
  if (!fs.existsSync(CTEST.LOG_DIR)) fs.mkdirSync(CTEST.LOG_DIR);
}
