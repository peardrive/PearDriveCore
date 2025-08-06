/*!
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
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import Hyperbee from "hyperbee";

import * as utils from "./utils/index.js";
import * as C from "./constants.js";

/**
 * Handles watching and indexing local files.
 */
export default class LocalFileIndex {
  /** Logger instance */
  #log;
  /** Automatic polling interval function */
  #poller;

  /**
   * @param {Object} opts
   * @param {any} opts.log - Optional logger instance
   * @param {import('corestore')} opts.store - Corestore instance
   * @param {string} opts.watchPath - Path to watch for local files
   * @param {Function} opts.emitEvent - Optional function to emit events
   * @param {Object} opts.indexOpts - Index options
   * @param {string} [opts.name] - Optional core name
   *    (defauls to 'local-file-index)
   */
  constructor({
    log,
    store,
    watchPath,
    emitEvent,
    indexOpts,
    name = "local-file-index",
  }) {
    // Logger setup
    this.#log = log;
    this.#log.info("Initializing LocalFileIndex...");

    this.#poller = null;

    /** Event emitter */
    this._emitEvent = emitEvent;
    /** Corestore instance */
    this._store = store;
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
    return this.#pollAndSync();
  }

  /** Poll automatically for new files in the local folder */
  startPolling() {
    if (this.#poller) return;
    this.#log.info("Starting automatic polling for local files...");

    this._indexOpts.poll = true;
    this.#poller = setInterval(
      async () => this.#pollAndSync(),
      this._indexOpts.pollInterval
    );
  }

  /** Stop automatic polling for new files in the local folder */
  stopPolling() {
    if (!this.#poller) return;
    this.#log.info("Stopping automatic polling for local files...");

    this._indexOpts.poll = false;
    clearInterval(this.#poller);
    this.#poller = null;
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

  /** Poll for new files and sync with hyperbee */
  async #pollAndSync() {
    this.#log.info("Polling for new files in", this.watchPath, "...");

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
}
