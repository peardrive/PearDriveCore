import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Root directory of test folder */
export const TEST_ROOT_DIR = path.resolve(__dirname, "..");
/** Base directory for all mock data */
export const TEST_MOCK_DATA_DIR = `${TEST_ROOT_DIR}/mock`;
/** Directory to store all generated corestores */
export const CORESTORE_DIR = `${TEST_MOCK_DATA_DIR}/cores`;
/** Directory to store all generated watchPaths */
export const WATCHPATH_DIR = `${TEST_MOCK_DATA_DIR}/watchpaths`;
/** Directory to store all log files */
export const LOG_DIR = `${TEST_MOCK_DATA_DIR}/logs`;
