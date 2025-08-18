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
 * Handles watching and indexing local files.
 *
 * @protected
 */
export default class LocalFileIndex {
  /** Logger instance */
  #log;
  /** Automatic polling interval function */
  #poller;

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
    /** Whether or not currently polling */
    this._polling = false;
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

    this.#log.info("LocalFileIndexer is ready!");
  }

  /** Close the LocalFileIndex gracefully */
  async close() {
    this.#log.info("Closing LocalFileIndexer...");

    // Stop polling
    this.stopPolling();

    // Close the hyperbee
    if (this.bee) {
      await this.bee.close();
      this.bee = null;
    }

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
    for await (const _ of this.bee.createReadStream()) {
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
      await this.bee.put(relativePath, metaData);
    }

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
    this._indexOpts.poll = true;

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

    const beeEntry = await this.bee.get(filePath);
    if (!beeEntry) {
      this.#log.warn(`File not found in index: ${filePath}`);
      return null;
    }
    return beeEntry.value;
  }

  //////////////////////////////////////////////////////////////////////////////
  // Private functions
  //////////////////////////////////////////////////////////////////////////////

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

  /**
   * Poll for new files and sync with hyperbee
   *
   * @param {boolean} [continuous=true] - Whether to continue polling
   */
  async #pollAndSync(continuous = false) {
    if (this._polling) {
      this.#log.warn("Already polling, skipping this run.");
      return;
    }

    this.#log.debug("Polling for new files in", this.watchPath, "...");

    // Load all existing file keys from hyperbee
    const storedFiles = new Map();
    for await (const { key, value } of this.bee.createReadStream()) {
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
        await this.bee.del(storedPath);
        this._emitEvent(C.EVENT.LOCAL, null);
      }
    }

    // Detect new or modified files
    for (const [path, meta] of currentFiles.entries()) {
      const storedMeta = storedFiles.get(path);
      if (!storedMeta || storedMeta.hash !== meta.hash) {
        this.#log.info(storedMeta ? "File updated:" : "New file added:", path);
        await this.bee.put(path, meta);
        this._emitEvent(C.EVENT.LOCAL, null);
      }
    }

    this.#log.debug("Polling complete.");

    // If this is a continuous poll, ensure that automatic polling is enabled
    // and if so, set the next poll timeout
    if (continuous && this._indexOpts.poll) {
      this.#poller = setTimeout(
        () => this.#pollAndSync(true),
        this._indexOpts.pollInterval
      );
    }

    this._polling = false;
  }

  /** Recursively scan a dir and fill map with file metaData */
  async #scanDirectory(dir, outMap, relativeBase = this.watchPath) {
    this.#log.info("Scanning directory", dir, "...");

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
   * Mark a file as busy for upload or download
   *
   * @param {string} path - (Relative) path to the file
   *
   * @private
   */
  #markBusy(path) {}

  /**
   *
   * @param {string} path - (Relative) path to the file
   *
   * @private
   */
  #markNotBusy(path) {}

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
