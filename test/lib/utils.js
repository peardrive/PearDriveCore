import fs from "fs";
import chalk from "chalk";
import path from "path";
import Corestore from "corestore";

import * as Ctest from "./constants.js";
import * as C from "../../src/constants.js";
import Sister from "../../src/Sister.js";
import LocalFileIndex from "../../src/LocalFileIndex.js";
import Logger from "../../src/Logger.js";

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

/** Resolves when given array of Sisters are all connected */
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
 * Creates and initializes a Sister instance with isolated mock-data folders.
 *
 * @param {string} name - Unique test identifier
 * @param {Uint8Array[]} bootstrap - DHT bootstrap nodes
 * @param {Function} [onError] - Optional error handler callback
 * @param {Object} [indexOpts] - Optional index options
 *
 * @returns {Promise<Object>} - { pd, localDrivePath, corestorePath, logPath }
 */
export async function createSister(
  name,
  bootstrap,
  onError = () => {},
  indexOpts = {
    poll: true,
    pollInterval: 500,
  }
) {
  // prepare directories
  const localDrivePath = path.join(Ctest.LD_DIR, name);
  const corestorePath = path.join(Ctest.CORESTORE_DIR, name);
  const logPath = path.join(Ctest.LOG_DIR, `${name}.log`);
  fs.mkdirSync(localDrivePath, { recursive: true });
  fs.mkdirSync(corestorePath, { recursive: true });

  // instantiate Sister
  const pd = new Sister({
    watchPath: localDrivePath,
    corestorePath,
    indexName: name,
    swarmOpts: { bootstrap },
    logOpts: {
      logToFile: true,
      logFilePath: logPath,
      logToConsole: false,
    },
    indexOpts,
    onError,
  });

  return { pd, localDrivePath, corestorePath, logPath };
}

/**
 * Creates a sisterhood of n Sister peers, each with its own storage folders.
 * @param {string} baseName - Base name for each peer's folders
 * @param {Array} bootstrap - DHT bootstrap nodes
 * @param {number} n - Number of peers to create
 * @param {Function} [onError] - Optional error callback
 * @returns {Promise<Object[]>} - Array of sister descriptor objects { pd,
 *  localDrivePath, corestorePath, logPath }
 */
export async function createSisterhood(
  baseName,
  bootstrap,
  n,
  onError = () => {}
) {
  const peers = [];
  for (let i = 0; i < n; i++) {
    const name = `${baseName}${i}`;
    const peer = await createSister(name, bootstrap, onError);
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
  });

  return {
    indexer,
    localDrivePath,
    corestorePath,
    logPath,
    name,
  };
}
