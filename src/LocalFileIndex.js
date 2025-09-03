/*!
 * Copyright (C) 2025 PearDrive
 * Copyright (C) 2025 Jenna Baudelaire
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

/**
 * @remarks Handles watching and indexing local files.
 *
 * @protected
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import Hyperbee from "hyperbee";
import ReadyResource from "ready-resource";

import * as utils from "./utils/index.js";
import * as C from "./constants.js";
const { LFI_EVENT } = C;

/**
 * Handles watching and indexing local files.
 *
 * @protected
 */
export default class LocalFileIndex extends ReadyResource {
  /** Logger instance */
  #log;
  /** Automatic polling interval function */
  #poller = null;
  /** File system watcher instance */
  #watcher = null;
  /** File watcher map */
  #dirWatchers = new Map();
  /** Debounce timers for file changes */
  #debounceTimers = new Map();
  /** Cache for file metadata to avoid re-hashing */
  #metadataCache = new Map();
  /** Set of paths currently being processed */
  #processingPaths = new Set();
  /** The hyperbee for file indexing */
  #bee = null;

  /**
   * @param {Object} opts
   *    @param {any} opts.log - Optional logger instance
   *    @param {import('corestore')} opts.store - Corestore instance
   *    @param {string} opts.watchPath - Path to watch for local files
   *    @param {Function} opts.emitEvent - Optional function to emit events
   *    @param {Object} opts.indexOpts - Index options
   *    @param {Map<string, HyperDrive} opts.downloads - Map of download drives
   *      and corestore subspaces
   *    @param {Map<string, HyperDrive} opts.uploads - Map of upload drives and
   *      corestore subspaces
   *    @param {string} [opts.name] - Optional core name (defaults to
   *      'local-file-index)
   */
  constructor({
    log,
    store,
    watchPath,
    emitEvent,
    indexOpts,
    uploads,
    downloads,
    name = "local-file-index",
  }) {
    super();

    // Logger setup
    this.#log = log;
    this.#log.info("Initializing LocalFileIndex...");

    /** Event emitter */
    this._emitEvent = emitEvent;
    /** Corestore instance */
    this._store = store.namespace("peardrive:localfileindex");
    /** Absolute path to folder being watched */
    this.watchPath = watchPath;
    /** Local file index core name */
    this.name = name || "local-file-indexer";
    /** Local file index core */
    this.indexCore = this._store.get({
      name: this.name,
      valueEncoding: "json",
    });
    /** Index options */
    this._indexOpts = indexOpts;
    /** Upload drives */
    this._uploads = uploads;
    /** Download drives */
    this._downloads = downloads;
    /** Whether or not currently polling */
    this._polling = false;
    /** Debounce delay (in ms) */
    this._debounceDelay = 500;
    /** Use native file watching */
    this._useNativeWatching = true;
  }

  //////////////////////////////////////////////////////////////////////////////
  // Getters and setters
  //////////////////////////////////////////////////////////////////////////////

  /** Hyperbee instance */
  get bee() {
    return this.#bee;
  }

  //////////////////////////////////////////////////////////////////////////////
  // Public functions
  //////////////////////////////////////////////////////////////////////////////

  /** Get save data as a JSON object */
  getSaveData() {
    return {
      watchPath: this.watchPath,
      localFileIndexName: this.name,
      logOpts: {},
    };
  }

  /** Build the hyperbee index */
  async buildIndex() {
    this.#log.info("Checking if building index is necessary...");
    let isEmpty = true;
    for await (const _ of this.#bee.createReadStream()) {
      isEmpty = false;
      break;
    }

    if (!isEmpty) {
      this.#log.info("Index already exists, skipping build.");
      return;
    }

    this.#log.info("Building index for local files...");
    const files = new Map();
    await this.#scanDirectory(this.watchPath, files);

    for (const [relativePath, metaData] of files.entries()) {
      isEmpty = false;
      this.#log.info("Adding file to index:", relativePath);
      await this.#bee.put(relativePath, metaData);
    }

    if (!isEmpty) this._emitEvent(C.EVENT.LOCAL, null);
    this.#log.info("Index build complete!");
  }

  /** Retrieve the hyperbee instance */
  getBee() {
    if (!this.#bee) {
      this.#log.error("Bee is not initialized. Call ready() first.");
      throw new Error("Bee is not initialized. Call ready() first.");
    }
    return this.#bee;
  }

  /** Retrieve the index key (hyperbee key) */
  getKey() {
    if (!this.#bee) {
      this.#log.error("Bee is not initialized. Call ready() first.");
      throw new Error("Bee is not initialized. Call ready() first.");
    }
    return this.#bee.key;
  }

  /** Poll local files once */
  pollOnce() {
    this.#log.info("Polling local files once...");
    return this.#pollAndSync(false);
  }

  /**
   * Asynchronous poll process, automatically scans for new files in the local
   * folder
   */
  async startPolling() {
    if (this.#poller || this._running) return;
    this.#log.info("Starting automatic polling for local files...");

    this._running = true;
    this._indexOpts.disablePolling = false;

    this.#pollAndSync(true);
  }

  /** Stop automatic polling for new files in the local folder */
  stopPolling() {
    if (!this.#poller) return;
    this.#log.info("Stopping automatic polling for local files...");

    this._indexOpts.poll = false;
    clearInterval(this.#poller);
    this.#poller = null;
  }

  /**
   * Get local file metadata and bee metadata
   *
   * @return {Promise<{key: string, files: Map<any, any>}>} - Local file info
   * and bee metadata
   *
   * @throws {Error} If bee is not initialized
   */
  async getIndexInfo() {
    this.#log.info("Retrieving local file info...");

    if (!this.#bee) {
      this.#log.error("Local index bee is not initialized.");
      throw new Error("Local index bee is not initialized.");
    }

    const files = [];
    for await (const { key, value } of this.#bee.createReadStream()) {
      files.push({ key: utils.formatToStr(key), ...value });
    }

    return {
      key: utils.formatToStr(this.getKey()),
      files,
    };
  }

  /**
   * Get file metadata for a given file path
   *
   * @param {string} filePath - relative path to the file
   *
   * @returns {Promise<Object | null>} - File metadata object
   */
  async getFileMetadata(filePath) {
    this.#log.info(`Retrieving metadata for file: ${filePath}`);

    if (!this.#bee) {
      this.#log.error("Local index bee is not initialized.");
      throw new Error("Local index bee is not initialized.");
    }

    const beeEntry = await this.#bee.get(filePath);
    if (!beeEntry) {
      this.#log.warn(`File not found in index: ${filePath}`);
      return null;
    }
    return beeEntry.value;
  }

  //////////////////////////////////////////////////////////////////////////////
  // Private functions
  //////////////////////////////////////////////////////////////////////////////

  // -- Polling system -------------------------------------------------------//
  // Scans the local directory for new and deleted files and syncs with hyperbee

  /**
   * Poll for new files and sync with hyperbee
   *
   * @param {boolean} [continuous=true] - Whether to continue polling
   */
  async #pollAndSync(continuous = false) {
    if (this._polling) {
      this.#log.warn("Already polling, skipping this iteration.");
      return;
    }

    this.#log.debug("Polling for new files in", this.watchPath, "...");

    try {
      // Load all existing file keys from hyperbee
      const storedFiles = new Map();
      for await (const { key, value } of this.#bee.createReadStream()) {
        storedFiles.set(utils.formatToStr(key), value);
      }

      // Recursively scan local directory
      const currentFiles = new Map();
      await this.#scanDirectory(this.watchPath, currentFiles);

      // Check for deleted files
      for (const storedPath of storedFiles.keys()) {
        if (!currentFiles.has(storedPath)) {
          if (this.#isBusy(storedPath)) {
            this.#log.info("Busy file not deleted!", storedPath);
            continue;
          }
          this.#log.info("File deleted:", storedPath);
          await this.#bee.del(storedPath);
          this._emitEvent(C.EVENT.LOCAL, null);
        }
      }

      // Detect new or modified files
      for (const [path, meta] of currentFiles.entries()) {
        const storedMeta = storedFiles.get(path);
        if (!storedMeta || storedMeta.hash !== meta.hash) {
          this.#log.info(
            storedMeta ? "File updated:" : "New file added:",
            path
          );
          await this.#bee.put(path, meta);
          this._emitEvent(C.EVENT.LOCAL, null);
        }
      }

      this.#log.debug("Polling complete.");

      // If this is a continuous poll, ensure that automatic polling is enabled
      // and if so, set the next poll timeout
      if (continuous && this._indexOpts.poll) {
        this.#poller = setTimeout(
          async () => await this.#pollAndSync(true),
          this._indexOpts.pollInterval
        );
      }
    } catch (error) {
      this.#log.error("Error during polling:", error);
    } finally {
      this._polling = false;
    }
  }

  /** Recursively scan a dir and fill map with file metaData */
  async #scanDirectory(dir, outMap, relativeBase = this.watchPath) {
    this.#log.debug("Scanning directory", dir, "...");

    // Check all files
    const entries = fs.readdirSync(dir);
    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      const stat = fs.statSync(fullPath);

      // If it's a directory, recurse into it
      if (stat.isDirectory()) {
        await this.#scanDirectory(fullPath, outMap, relativeBase);
      }

      // If it's a file, add to map
      else if (stat.isFile()) {
        const relativePath = path.relative(relativeBase, fullPath);

        // Ensure file isn't busy (in the middle of an upload/download)
        if (this.#isBusy(relativePath)) {
          this.#log.info("Skipping busy file:", relativePath);
          continue;
        }

        const hash = await this.#hashFile(fullPath);
        outMap.set(relativePath, {
          path: relativePath,
          size: stat.size,
          modified: stat.mtimeMs,
          hash,
        });
      }
    }
  }

  /**
   * Determine if a file is busy at given path
   *
   * @param {string} path - (Relative) path to the file
   *
   * @return {boolean} - True if file is busy, false otherwise
   */
  #isBusy(path) {
    const dPath = utils.asDrivePath(path);
    return this._uploads.has(dPath) || this._downloads.has(dPath);
  }
  //-- End polling system ----------------------------------------------------//

  //-- File watching system --------------------------------------------------//
  // Watches files and directories for file changes, hashes those changes and
  // updates the hyperbee index accordingly.

  /** Start native file system watching */
  async #startNativeWatching() {
    this.#log.info("Starting native file system watching...");

    try {
      this.#watchDirectory(this.watchPath);
      await this.#watchSubdirectories(this.watchPath);
    } catch (error) {
      this.#log.error("Error starting native file watching:", error);
      this.#log.info("Falling back to polling mode.");
      this._useNativeWatching = false;
      return;
    }
  }

  /** Stop native file system watching */
  #stopNativeWatching() {
    this.#log.info("Stopping native file system watching...");

    for (const [dir, watcher] of this.#dirWatchers) {
      watcher.close();
      this.#log.info(`Stopped watching directory: ${dir}`);
    }
    this.#dirWatchers.clear();
  }

  /** Load metadata cache from bee */
  async #loadMetadataCache() {
    this.#log.info("Loading metadata cache...");

    for await (const { key, value } of this.#bee.createReadStream()) {
      const formattedKey = utils.formatToStr(key);
      this.#metadataCache.set(formattedKey, value);
      this.#log.debug(`Cached metadata for: ${formattedKey}`);
    }

    this.#log.info("Metadata cache loaded successfully!");
  }

  /** Watch a specific directory */
  async #watchDirectory(dir) {
    if (this.#dirWatchers.has(dir)) {
      this.#log.warn(`Tried to watch already watched directory: ${dir}`);
      return;
    }

    this.#log.info(`Watching directory: ${dir}`);
    try {
      const watcher = fs.watch(
        dir,
        { persistent: false },
        (eventType, filename) => {
          if (!filename) return;

          const fullPath = path.join(dir, filename);
          const relativePath = path.relative(this.watchPath, fullPath);

          // Debounce file changes to avoid multiple events
          this.#debounceFileChange(relativePath, fullPath, eventType);
        }
      );

      this.#dirWatchers.set(dir, watcher);
    } catch (err) {
      this.#log.warn(`Failed to watch directory ${dir}:`, err.message);
    }
  }

  /** Recursively watch all subdirectories */
  async #watchSubdirectories(dirPath) {
    return new Promise((resolve) => {
      try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });

        const promises = [];
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const subDirPath = path.join(dirPath, entry.name);
            this.#watchDirectory(subDirPath);
            promises.push(this.#watchSubdirectories(subDirPath));
          }
        }

        Promise.all(promises).then(() => resolve());
      } catch (err) {
        this.#log.warn(
          `Failed to scan subdirectories of ${dirPath}:`,
          err.message
        );
        resolve();
      }
    });
  }

  /** Debounce file change events */
  #debounceFileChange(relativePath, fullPath, eventType) {
    // Clear existing timer for this path
    if (this.#debounceTimers.has(relativePath)) {
      clearTimeout(this.#debounceTimers.get(relativePath));
    }

    // Set new debounced timer
    const timer = setTimeout(async () => {
      this.#debounceTimers.delete(relativePath);
      await this.#handleFileChange(relativePath, fullPath, eventType);
    }, this._debounceDelay);

    this.#debounceTimers.set(relativePath, timer);
  }

  /** Handle a file change event */
  async #handleFileChange(relativePath, fullPath) {
    // Add processing path if not already processing
    if (this.#processingPaths.has(relativePath)) return;
    this.#processingPaths.add(relativePath);

    try {
      // Check if file/directory exists
      let exists = false;
      let isDirectory = false;

      try {
        const fileStat = fs.statSync(fullPath);
        exists = true;
        isDirectory = fileStat.isDirectory();
      } catch (err) {
        // File doesn't exist (was deleted)
        exists = false;
      }

      if (!exists) {
        // If file is currently being uploaded/downloaded, noop
        if (this.#isBusy(relativePath)) {
          this.#log.info("Busy file not deleted!", relativePath);
          return;
        }

        // File must have been deleted
        if (this.#metadataCache.has(relativePath)) {
          this.#log.info("File deleted:", relativePath);
          await this.#bee.del(relativePath);
          this.#metadataCache.delete(relativePath);
          this.emit(LFI_EVENT.FILE_REMOVED, relativePath);
          this._emitEvent(C.EVENT.LOCAL, null);
        }
      } else if (isDirectory) {
        // New directory created - watch it
        this.#watchDirectory(fullPath);
        await this.#watchSubdirectories(fullPath);
      } else {
        // File was added or modified
        await this.#updateFile(relativePath, fullPath);
      }
    } catch (err) {
      this.#log.error(`Error handling file change for ${relativePath}:`, err);
    } finally {
      this.#processingPaths.delete(relativePath);
    }
  }

  /** Update a single file in the index */
  async #updateFile(relativePath, fullPath) {
    if (this.#isBusy(relativePath)) {
      this.#log.debug("Skipping busy file:", relativePath);
      return;
    }

    try {
      const fileStat = fs.statSync(fullPath);

      // Check if we need to hash
      const cachedMeta = this.#metadataCache.get(relativePath);
      let needsWrite = false;
      let changed = false;
      let prevHash, hash;

      // If the file was previously registered
      if (cachedMeta) {
        prevHash = cachedMeta.hash;
        hash = cachedMeta.hash;

        // Check if file has already been logged and is unchanged. If so, noop
        const unchanged =
          cachedMeta.size === fileStat.size &&
          cachedMeta.modified === fileStat.mtimeMs;
        if (unchanged) {
          this.#log.debug("File unchanged no event emitting:", relativePath);
          return;
        }

        // A change has occurred, rehash and check if hash has changed
        hash = await this.#hashFile(fullPath);
        changed = hash !== prevHash;
        needsWrite = true;
      }

      // If the file is new since last init/first init, always hash
      else {
        hash = await this.#hashFile(fullPath);
        needsWrite = true;
      }

      // File hasn't changed, use cached hash
      if (
        cachedMeta &&
        cachedMeta.size === fileStat.size &&
        cachedMeta.modified === fileStat.mtimeMs
      ) {
        needsHash = false;
      }

      // If nothing is supposed to change from last record of this file, return
      if (!needsWrite) {
        this.#log.debug("File unchanged no event emitting:", relativePath);
        return;
      }

      // Handle writing to bee
      const metadata = {
        path: relativePath,
        size: fileStat.size,
        modified: fileStat.mtimeMs,
        hash,
      };

      // Update bee/metadata
      await this.#bee.put(relativePath, metadata);
      this.#metadataCache.set(relativePath, metadata);

      // If indexed file got updated
      if (cachedMeta) {
        if (changed) {
          this.#log.debug("File changed:", relativePath);
          this.emit(LFI_EVENT.FILE_CHANGED, {
            path: relativePath,
            prevHash,
            hash,
          });
        }
      }

      // Unindexed file added
      else {
        this.#log.debug("New file added:", relativePath);
        this.emit(LFI_EVENT.FILE_ADDED, {
          path: relativePath,
          hash,
        });
      }

      // Backwards compat (remove in v1.6)
      this._emitEvent(C.EVENT.LOCAL, null);
    } catch (err) {
      this.#log.error(`Error updating file ${relativePath}:`, err);
    }
  }
  /** Generate the hash of a file
   *
   * @param {string} filePath - Absolute path to the file
   */
  async #hashFile(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash("sha256");
      const stream = fs.createReadStream(filePath);
      stream.on("data", (data) => hash.update(data));
      stream.on("end", () => resolve(hash.digest("hex")));
      stream.on("error", (err) => reject(err));
    });
  }
  //-- End file watching system ----------------------------------------------//

  //////////////////////////////////////////////////////////////////////////////
  // Lifecycle methods
  //////////////////////////////////////////////////////////////////////////////

  async _open() {
    this.#log.info("Opening LocalFileIndex...");

    // Ready corestore and create hyperbee
    await this.indexCore.ready();
    this.#bee = new Hyperbee(this.indexCore, {
      keyEncoding: "utf-8",
      valueEncoding: "json",
    });
    await this.#bee.ready();

    await this.#loadMetadataCache();

    // File polling / watching
    if (this._useNativeWatching) {
      await this.#startNativeWatching();
    } else {
      this.#log.info("Native file watching disabled, using polling mode.");
    }
    if (this._indexOpts.poll) {
      this.startPolling();
    }

    this.#log.info("LocalFileIndex opened successfully!");
  }

  async _close() {
    this.#log.info("Closing LocalFileIndex...");

    // Stop any ongoing polling or watching
    this.stopPolling();
    this.#stopNativeWatching();

    // Clear debounce timers
    for (const timer of this.#debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.#debounceTimers.clear();

    // Clear caches
    this.#metadataCache.clear();
    this.#processingPaths.clear();

    // Close hyperbee and core
    if (this.#bee) {
      await this.#bee.close();
      this.#bee = null;
    }
    await this.indexCore.close();

    this.#log.info("LocalFileIndex closed successfully!");
  }
}
