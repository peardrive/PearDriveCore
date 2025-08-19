import fs from "fs";
import chalk from "chalk";
import path from "path";
import Corestore from "corestore";
import Logger, { LOG_LEVELS } from "@hopets/logger";

import * as Ctest from "./constants.js";
import * as C from "../../src/constants.js";
import PearDrive from "../../src/PearDrive.js";
import LocalFileIndex from "../../src/LocalFileIndex.js";

/** Generate random string of given length */
export function generateString(length = 8) {
  const characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";

  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    result += characters[randomIndex];
  }

  return result;
}

/**
 * Wait for condition to be true
 *
 * @param {Function} conditionFn - Function that returns true when condition is
 *   met
 * @param {number} [timeout=5000] - Maximum time to wait in milliseconds
 * @param {number} [interval=100] - Interval to check condition in milliseconds
 */
export async function waitFor(conditionFn, timeout = 5000, interval = 100) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    if (await conditionFn()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  return false;
}

/**
 * Given two lists of files, ensure file.name and file.hash match for each of them
 */
export function filesMatch(files, expectedFiles) {
  if (files.length !== expectedFiles.length) {
    return false;
  }
  const fileMap = new Map(files.map((f) => [f.name, f.hash]));
  for (const file of expectedFiles) {
    if (!fileMap.has(file.name) || fileMap.get(file.name) !== file.hash) {
      return false;
    }
  }

  return true;
}

/** Create a random dummy text file in given basePath */
export function createRandomFile(basePath, length = 8) {
  const name = `${generateString(length)}.txt`;
  const path = `${basePath}/${name}`;
  const contents = generateString(length);

  fs.writeFileSync(path, contents);
  return {
    name,
    path,
    contents,
  };
}

/** Create a new random folder in a given basePath */
export function createNewFolderPath(basePath, length = 8) {
  return path.join(basePath, generateString(length));
}

/** Generate corestore folder path from given folder name */
export function generateCorestorePath(folderName) {
  return path.join(Ctest.CORESTORE_DIR, folderName);
}

/** Generate localdrive folder path from given folder name */
export function generateLocaldrivePath(folderName) {
  return path.join(Ctest.LD_DIR, folderName);
}

/** Create a localdrive folder */
export function createLocaldriveFolder(folderName) {
  const folderPath = path.join(Ctest.LD_DIR, folderName);
  fs.mkdirSync(folderPath, { recursive: true });

  let files = [];
  for (let i = 0; i < 3; i++) {
    const file = createRandomFile(folderPath);
    files.push(file);
  }
  return folderPath;
}

/** Create a corestore folder */
export function createCorestorePath(folderName) {
  const folderPath = path.join(Ctest.CORESTORE_DIR, folderName);
  fs.mkdirSync(folderPath, { recursive: true });

  return folderPath;
}

/** Resolves when given array of PearDrives are all connected */
export async function awaitAllConnected(instances, timeout = 60000) {
  let connected = false;
  const startTime = Date.now();

  // Flush all peers
  for (const instance of instances) {
    await instance._swarm.flush();
  }

  // Wait for connected status to activate
  while (!connected && Date.now() - startTime < timeout) {
    connected = instances.every((instance) => instance.connected);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return connected;
}

/** Wait for n seconds */
export function wait(n = 1) {
  return new Promise((resolve) => setTimeout(resolve, n * 1000));
}

/** Clear out mock data folders */
export function clearTestData() {
  if (fs.existsSync(Ctest.TEST_MOCK_DATA_DIR))
    fs.rmSync(Ctest.TEST_MOCK_DATA_DIR, { recursive: true });
}

/** Create test folders if they don't exist */
export function createTestFolders() {
  if (!fs.existsSync(Ctest.TEST_MOCK_DATA_DIR))
    fs.mkdirSync(Ctest.TEST_MOCK_DATA_DIR);
  if (!fs.existsSync(Ctest.LD_DIR)) fs.mkdirSync(Ctest.LD_DIR);
  if (!fs.existsSync(Ctest.CORESTORE_DIR)) fs.mkdirSync(Ctest.CORESTORE_DIR);
  if (!fs.existsSync(Ctest.LOG_DIR)) fs.mkdirSync(Ctest.LOG_DIR);
}

/** Text formats for test suite logs */
export const txt = {
  /** Primary test format */
  main: (text) => chalk.bold(text),
  /** Subtest format */
  sub: (text) => chalk.gray(text),
  /** Passed test format */
  pass: (text) => chalk.bold.green(text),
  /** Failed test format */
  fail: (text) => chalk.bold.red(text),
  /** Warning format */
  warn: (text) => chalk.bold.yellow(text),
};

/** Make sure a folder exists at the given absolute path */
export function ensureFolderExists(absolutePath) {
  try {
    fs.mkdirSync(absolutePath, { recursive: true });
    console.log("Folder created at", absolutePath);
  } catch (error) {
    console.error("Error creating folder", absolutePath, error);
  }
}

/** Delete folder */
export function deleteFolder(absolutePath) {
  fs.rmSync(absolutePath, { recursive: true });
}

/** Test object equality */
export function areObjectsEqual(obj1, obj2) {
  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);

  // Check if the number of keys is the same
  if (keys1.length !== keys2.length) return false;

  // Check if all keys and values are equal
  for (const key of keys1) {
    if (!obj2.hasOwnProperty(key) || obj1[key] !== obj2[key]) {
      return false;
    }
  }

  return true;
}

/**
 * Creates and initializes a PearDrive instance with isolated mock-data folders.
 *
 * @param {Object} opts - Options for PearDrive instance
 *    @param {string} opts.name - Unique test identifier
 *    @param {Uint8Array[]} opts.bootstrap - DHT bootstrap nodes
 *    @param {Function} [opts.onError] - Optional error handler callback
 *    @param {Object} [opts.indexOpts] - Optional index options
 *
 * @returns {Promise<Object>} - { pd, localDrivePath, corestorePath, logPath }
 */
export async function createPearDrive({
  name,
  bootstrap,
  onError = () => {},
  indexOpts = {
    poll: true,
    pollInterval: 500,
  },
}) {
  // prepare directories
  const localDrivePath = path.join(Ctest.LD_DIR, name);
  const corestorePath = path.join(Ctest.CORESTORE_DIR, name);
  const logPath = path.join(Ctest.LOG_DIR, `${name}.log`);
  fs.mkdirSync(localDrivePath, { recursive: true });
  fs.mkdirSync(corestorePath, { recursive: true });

  // instantiate PearDrive
  const pd = new PearDrive({
    watchPath: localDrivePath,
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

  return { pd, localDrivePath, corestorePath, logPath };
}

/**
 * Creates a network of n PearDrive peers, each with its own storage folders.
 *
 * @param {Object} opts - Options for network creation
 *    @param {string} opts.baseName - Base name for each peer's folders
 *    @param {Array} opts.bootstrap - DHT bootstrap nodes
 *    @param {number} opts.n - Number of peers to create
 *    @param {Function} [opts.onError] - Optional error callback
 *    @param {Object} [opts.indexOpts] - Optional index options
 *
 * @returns {Promise<Object[]>} - Array of PearDrive descriptor objects { pd,
 *  localDrivePath, corestorePath, logPath }
 */
export async function createNetwork({
  baseName,
  bootstrap,
  n,
  onError = () => {},
  indexOpts = {
    poll: true,
    pollInterval: 500,
  },
}) {
  const peers = [];
  for (let i = 0; i < n; i++) {
    const name = `${baseName}${i}`;
    const peer = await createPearDrive({
      name,
      bootstrap,
      onError,
      indexOpts,
    });
    await peer.pd.ready();
    if (i === 0) {
      await peer.pd.joinNetwork();
    } else {
      await peer.pd.joinNetwork(peers[0].pd.networkKey);
    }
    peers.push(peer);
  }

  await awaitAllConnected(peers.map((p) => p.pd));
  return peers;
}

/**
 * Creates and initializes a LocalFileIndex instance with proper test paths
 * @param {string} [name] - Optional unique test ID
 */
export async function makeLocalFileIndex(
  name = utils.generateString(),
  poll = true,
  pollInterval = 500
) {
  // Create directories
  const localDrivePath = path.join(Ctest.LD_DIR, name);
  const corestorePath = path.join(Ctest.CORESTORE_DIR, name);
  const logPath = path.join(Ctest.LOG_DIR, `${name}.log`);
  fs.mkdirSync(localDrivePath, { recursive: true });
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
    watchPath: localDrivePath,
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
    localDrivePath,
    corestorePath,
    logPath,
    name,
  };
}
