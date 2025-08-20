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

import * as utils from "./utils/index.js";
import * as C from "./constants.js";

/**
 * Handles watching and indexing local files with optimized resource usage.
 *
 * @protected
 */
export default class LocalFileIndex {
  /** Logger instance */
  #log;
  /** Automatic polling interval function */
  #poller;
  /** File system watcher instance */
  #watcher;
  /** Map of file watchers for subdirectories */
  #dirWatchers;
  /** Debounce timers for file changes */
  #debounceTimers;
  /** Cache for file metadata to avoid re-hashing */
  #metadataCache;
  /** Set of paths currently being processed */
  #processingPaths;

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
    // Logger setup
    this.#log = log;
    this.#log.info("Initializing LocalFileIndex...");

    this.#poller = null;
    this.#watcher = null;
    this.#dirWatchers = new Map();
    this.#debounceTimers = new Map();
    this.#metadataCache = new Map();
    this.#processingPaths = new Set();

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
    /** Store for the file watchers for each file */
    this.fileWatchers = new Map();
    /** The hyperbee for file indexer */
    this.bee = null;
    /** Index options */
    this._indexOpts = indexOpts;
    /** Upload drives */
    this._uploads = uploads;
    /** Download drives */
    this._downloads = downloads;
    /** Debounce delay in milliseconds */
    this._debounceDelay = 500;
    /** Use native file watching */
    this._useNativeWatching = true;
  }

  //////////////////////////////////////////////////////////////////////////////
  // Public functions
  //////////////////////////////////////////////////////////////////////////////

  /** Get corestores ready (run and complete this before using) */
  async ready() {
    this.#log.info("Getting LocalFileIndexer ready...");

    await this.indexCore.ready();
    this.bee = new Hyperbee(this.indexCore, {
      keyEncoding: "utf-8",
      valueEncoding: "json",
    });
    await this.bee.ready();

    // Load existing metadata into cache for optimization
    await this.#loadMetadataCache();

    // Start native file watching if enabled
    if (this._useNativeWatching) {
      await this.#startNativeWatching();
    }

    this.#log.info("LocalFileIndexer is ready!");
  }

  /** Close the LocalFileIndex gracefully */
  async close() {
    this.#log.info("Closing LocalFileIndexer...");

    // Stop polling
    this.stopPolling();

    // Stop native watching
    this.#stopNativeWatching();

    // Clear all debounce timers
    for (const timer of this.#debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.#debounceTimers.clear();

    // Close the hyperbee
    if (this.bee) {
      await this.bee.close();
      this.bee = null;
    }

    // Clear caches
    this.#metadataCache.clear();
    this.#processingPaths.clear();

    this.#log.info("LocalFileIndexer closed.");
  }

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
    for await (const _ of this.bee.createReadStream({ limit: 1 })) {
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

    // Batch write to bee for better performance
    const batch = this.bee.batch();
    for (const [relativePath, metaData] of files.entries()) {
      isEmpty = false;
      this.#log.info("Adding file to index:", relativePath);
      await batch.put(relativePath, metaData);
      // Update cache
      this.#metadataCache.set(relativePath, metaData);
    }
    await batch.flush();

    if (!isEmpty) this._emitEvent(C.EVENT.LOCAL, null);
    this.#log.info("Index build complete!");
  }

  /** Retrieve the hyperbee instance */
  getBee() {
    if (!this.bee) {
      this.#log.error("Bee is not initialized. Call ready() first.");
      throw new Error("Bee is not initialized. Call ready() first.");
    }
    return this.bee;
  }

  /** Retrieve the index key (hyperbee key) */
  getKey() {
    if (!this.bee) {
      this.#log.error("Bee is not initialized. Call ready() first.");
      throw new Error("Bee is not initialized. Call ready() first.");
    }
    return this.bee.key;
  }

  /** Poll local files once */
  pollOnce() {
    this.#log.info("Polling local files once...");
    return this.#pollAndSync();
  }

  /** Poll automatically for new files in the local folder */
  startPolling() {
    if (this.#poller) return;
    this.#log.info("Starting automatic polling for local files...");

    this._indexOpts.poll = true;
    // Use longer interval since we have native watching as primary method
    const pollInterval = this._useNativeWatching
      ? Math.max(this._indexOpts.pollInterval * 10, 300000) // 5 min minimum if using native watching
      : this._indexOpts.pollInterval;

    this.#poller = setInterval(async () => this.#pollAndSync(), pollInterval);
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

    if (!this.bee) {
      this.#log.error("Local index bee is not initialized.");
      throw new Error("Local index bee is not initialized.");
    }

    const files = [];
    for await (const { key, value } of this.bee.createReadStream()) {
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

    if (!this.bee) {
      this.#log.error("Local index bee is not initialized.");
      throw new Error("Local index bee is not initialized.");
    }

    // Check cache first
    if (this.#metadataCache.has(filePath)) {
      return this.#metadataCache.get(filePath);
    }

    const beeEntry = await this.bee.get(filePath);
    if (!beeEntry) {
      this.#log.warn(`File not found in index: ${filePath}`);
      return null;
    }

    // Update cache
    this.#metadataCache.set(filePath, beeEntry.value);
    return beeEntry.value;
  }

  //////////////////////////////////////////////////////////////////////////////
  // Private functions
  //////////////////////////////////////////////////////////////////////////////

  /** Load metadata cache from bee */
  async #loadMetadataCache() {
    this.#log.info("Loading metadata cache...");
    for await (const { key, value } of this.bee.createReadStream()) {
      this.#metadataCache.set(utils.formatToStr(key), value);
    }
    this.#log.info(`Loaded ${this.#metadataCache.size} entries into cache`);
  }

  /** Start native file system watching */
  async #startNativeWatching() {
    this.#log.info("Starting native file system watching...");

    try {
      // Watch the root directory
      this.#watchDirectory(this.watchPath);

      // Recursively watch all subdirectories
      await this.#watchSubdirectories(this.watchPath);

      this.#log.info("Native file watching started successfully");
    } catch (err) {
      this.#log.error("Failed to start native watching:", err);
      this.#log.info("Falling back to polling only");
      this._useNativeWatching = false;
    }
  }

  /** Watch a specific directory */
  #watchDirectory(dirPath) {
    if (this.#dirWatchers.has(dirPath)) return;

    try {
      const watcher = fs.watch(
        dirPath,
        { persistent: false },
        (eventType, filename) => {
          if (!filename) return;

          const fullPath = path.join(dirPath, filename);
          const relativePath = path.relative(this.watchPath, fullPath);

          // Debounce file changes to avoid multiple events
          this.#debounceFileChange(relativePath, fullPath, eventType);
        }
      );

      this.#dirWatchers.set(dirPath, watcher);
    } catch (err) {
      this.#log.warn(`Failed to watch directory ${dirPath}:`, err.message);
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

  /** Stop native file system watching */
  #stopNativeWatching() {
    this.#log.info("Stopping native file system watching...");

    for (const [dirPath, watcher] of this.#dirWatchers) {
      watcher.close();
    }
    this.#dirWatchers.clear();
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
  async #handleFileChange(relativePath, fullPath, eventType) {
    // Prevent concurrent processing of the same path
    if (this.#processingPaths.has(relativePath)) {
      return;
    }

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
        // File was deleted
        if (this.#isBusy(relativePath)) {
          this.#log.info("Busy file not deleted!", relativePath);
          return;
        }

        if (this.#metadataCache.has(relativePath)) {
          this.#log.info("File deleted:", relativePath);
          await this.bee.del(relativePath);
          this.#metadataCache.delete(relativePath);
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
      this.#log.info("Skipping busy file:", relativePath);
      return;
    }

    try {
      const fileStat = fs.statSync(fullPath);

      // Check if we need to recalculate hash
      const cachedMeta = this.#metadataCache.get(relativePath);
      let needsHash = true;
      let hash;

      if (
        cachedMeta &&
        cachedMeta.size === fileStat.size &&
        cachedMeta.modified === fileStat.mtimeMs
      ) {
        // File hasn't changed, use cached hash
        needsHash = false;
        hash = cachedMeta.hash;
      } else {
        // File changed, recalculate hash
        hash = await this.#hashFile(fullPath);
      }

      const metadata = {
        path: relativePath,
        size: fileStat.size,
        modified: fileStat.mtimeMs,
        hash,
      };

      // Only update if metadata actually changed
      if (!cachedMeta || cachedMeta.hash !== hash) {
        this.#log.info(
          cachedMeta ? "File updated:" : "New file added:",
          relativePath
        );
        await this.bee.put(relativePath, metadata);
        this.#metadataCache.set(relativePath, metadata);
        this._emitEvent(C.EVENT.LOCAL, null);
      }
    } catch (err) {
      this.#log.error(`Error updating file ${relativePath}:`, err);
    }
  }

  /** Generate the hash of a file (optimized with streams) */
  async #hashFile(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash("sha256");
      const stream = fs.createReadStream(filePath, {
        highWaterMark: 64 * 1024,
      }); // 64KB chunks
      stream.on("data", (data) => hash.update(data));
      stream.on("end", () => resolve(hash.digest("hex")));
      stream.on("error", (err) => reject(err));
    });
  }

  /** Poll for new files and sync with hyperbee (optimized) */
  async #pollAndSync() {
    this.#log.info("Polling for new files in", this.watchPath, "...");

    // Use cached metadata instead of loading from bee each time
    const storedFiles = new Map(this.#metadataCache);

    // Recursively scan local directory (using async pattern)
    const currentFiles = new Map();
    await this.#scanDirectory(this.watchPath, currentFiles);

    // Batch operations for better performance
    const batch = this.bee.batch();
    let hasChanges = false;

    // Check for deleted files
    for (const storedPath of storedFiles.keys()) {
      if (!currentFiles.has(storedPath)) {
        if (this.#isBusy(storedPath)) {
          this.#log.info("Busy file not deleted!", storedPath);
          continue;
        }
        this.#log.info("File deleted:", storedPath);
        await batch.del(storedPath);
        this.#metadataCache.delete(storedPath);
        hasChanges = true;
      }
    }

    // Detect new or modified files
    for (const [path, meta] of currentFiles.entries()) {
      const storedMeta = storedFiles.get(path);
      if (!storedMeta || storedMeta.hash !== meta.hash) {
        this.#log.info(storedMeta ? "File updated:" : "New file added:", path);
        await batch.put(path, meta);
        this.#metadataCache.set(path, meta);
        hasChanges = true;
      }
    }

    // Flush batch
    if (hasChanges) {
      await batch.flush();
      this._emitEvent(C.EVENT.LOCAL, null);
    }
  }

  /** Recursively scan a dir and fill map with file metaData (async pattern for Bare) */
  async #scanDirectory(dir, outMap, relativeBase = this.watchPath) {
    this.#log.info("Scanning directory", dir, "...");

    return new Promise(async (resolve) => {
      try {
        // Use sync readdir but wrap in async pattern for consistency
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        // Process entries in smaller batches to avoid blocking
        const BATCH_SIZE = 10;
        for (let i = 0; i < entries.length; i += BATCH_SIZE) {
          const batch = entries.slice(i, i + BATCH_SIZE);

          // Process batch entries sequentially but with async hash
          for (const entry of batch) {
            const fullPath = path.join(dir, entry.name);

            try {
              if (entry.isDirectory()) {
                // Recurse into directory
                await this.#scanDirectory(fullPath, outMap, relativeBase);
              } else if (entry.isFile()) {
                const relativePath = path.relative(relativeBase, fullPath);

                // Skip busy files
                if (this.#isBusy(relativePath)) {
                  this.#log.info("Skipping busy file:", relativePath);
                  continue;
                }

                const fileStat = fs.statSync(fullPath);

                // Check cache to avoid re-hashing unchanged files
                const cachedMeta = this.#metadataCache.get(relativePath);
                let hash;

                if (
                  cachedMeta &&
                  cachedMeta.size === fileStat.size &&
                  cachedMeta.modified === fileStat.mtimeMs
                ) {
                  // Use cached hash
                  hash = cachedMeta.hash;
                } else {
                  // Recalculate hash (this is async)
                  hash = await this.#hashFile(fullPath);
                }

                outMap.set(relativePath, {
                  path: relativePath,
                  size: fileStat.size,
                  modified: fileStat.mtimeMs,
                  hash,
                });
              }
            } catch (err) {
              this.#log.warn(`Error processing ${fullPath}:`, err.message);
            }
          }

          // Small delay between batches to prevent blocking
          await new Promise((r) => setTimeout(r, 0));
        }

        resolve();
      } catch (err) {
        this.#log.warn(`Error scanning directory ${dir}:`, err.message);
        resolve();
      }
    });
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
}
