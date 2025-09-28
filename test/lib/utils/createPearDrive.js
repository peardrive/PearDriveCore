import path from "path";
import fs from "fs";
import { LOG_LEVELS } from "@hopets/logger";

import PearDrive from "../../../src/PearDrive.js";
import * as CTEST from "../constants.js";

/**
 * Creates and initializes a PearDrive instance with isolated mock-data folders.
 *
 * @param {Object} opts - Options for PearDrive instance
 *    @param {string} opts.name - Unique test identifier
 *    @param {Uint8Array[]} opts.bootstrap - DHT bootstrap nodes
 *    @param {Function} [opts.onError] - Optional error handler callback
 *    @param {Object} [opts.indexOpts] - Optional index options
 *    @param {boolean} [opts.indexOpts.disablePolling] - Option to disable
 *      automatic polling
 *
 * @returns {Promise<Object>} - { pd, watchPath, corestorePath, logPath }
 */
export async function createPearDrive({
  name,
  bootstrap,
  onError = () => {},
  indexOpts = {
    disablePolling: false,
    pollInterval: 500,
  },
}) {
  // prepare directories
  const watchPath = path.join(CTEST.WATCHPATH_DIR, name);
  const corestorePath = path.join(CTEST.CORESTORE_DIR, name);
  const logPath = path.join(CTEST.LOG_DIR, `${name}.log`);
  fs.mkdirSync(watchPath, { recursive: true });
  fs.mkdirSync(corestorePath, { recursive: true });

  // instantiate PearDrive
  const pd = new PearDrive({
    watchPath,
    corestorePath,
    indexName: name,
    swarmOpts: { bootstrap },
    logOpts: {
      logToFile: true,
      logFilePath: logPath,
      logToConsole: false,
      level: LOG_LEVELS.DEBUG,
    },
    indexOpts,
    onError,
  });

  return { pd, watchPath, corestorePath, logPath };
}
