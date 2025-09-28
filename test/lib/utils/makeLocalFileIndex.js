import fs from "fs";
import path from "path";
import Corestore from "corestore";
import Logger from "@hopets/logger";

import * as CTEST from "../constants.js";
import LocalFileIndex from "../../../src/LocalFileIndex.js";

/**
 * Creates and initializes a LocalFileIndex instance with proper test paths
 *
 * @param {string} [name] - Optional unique test ID
 * @param {boolean} [poll=true] - Whether to enable polling for file changes
 * @param {number} [pollInterval=500] - Polling interval in ms
 *
 * @returns {Promise<Object>} - { indexer, watchPath, corestorePath,
 * logPath, name }
 */
export async function makeLocalFileIndex(
  name = utils.generateString(),
  poll = true,
  pollInterval = 500
) {
  // Create directories
  const watchPath = path.join(CTEST.WATCHPATH_DIR, name);
  const corestorePath = path.join(CTEST.CORESTORE_DIR, name);
  const logPath = path.join(CTEST.LOG_DIR, `${name}.log`);
  fs.mkdirSync(watchPath, { recursive: true });
  fs.mkdirSync(corestorePath, { recursive: true });

  // Create dependency objects
  const log = new Logger({
    logToFile: true,
    logFilePath: logPath,
  });
  const indexOpts = {
    poll,
    pollInterval,
  };

  const store = new Corestore(corestorePath);

  // create LocalFileIndex instance
  const indexer = new LocalFileIndex({
    store,
    watchPath,
    name,
    log,
    emitEvent: (eventName, payload) => {
      log.info(`Event emitted: ${eventName}`, payload);
    },
    indexOpts,
    uploads: new Map(),
    downloads: new Map(),
  });

  return {
    indexer,
    watchPath,
    corestorePath,
    logPath,
    name,
  };
}
