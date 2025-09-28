import fs from "fs";

import * as CTEST from "../constants.js";

/** Clear out mock data folders */
export function clearTestData() {
  if (fs.existsSync(CTEST.TEST_MOCK_DATA_DIR))
    fs.rmSync(CTEST.TEST_MOCK_DATA_DIR, { recursive: true });
}
