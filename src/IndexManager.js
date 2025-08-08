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
 * @remarks Manages the indexing of all files locally and on the network.
 *
 * @protected
 */

import Hyperbee from "hyperbee";
import Hyperdrive from "hyperdrive";
import fs from "fs";

import * as C from "./constants.js";
import * as utils from "./utils/index.js";
import LocalFileIndex from "./LocalFileIndex.js";

/*******************************************************************************
 * IndexManager
 * ---
 * Manages the peer-to-peer synchronization of file-index Hyperbees.
 *
 * @protected
 ******************************************************************************/
export class IndexManager {
  /** @private {Corestore} */
  _store;
  /** @private {Logger} */
  #log;

  /**
   * @param {Object} opts
   * @param {Corestore} opts.store - Corestore instance for managing Hypercores
   * @param {Logger}    opts.log - Logger for informational output
   * @param {string}    opts.watchPath - Path to watch for local files
   * @param {any} opts.emitEvent - Function to emit events
   * @param {Object} indexOpts - Options for the local file index
   * @param {Map<string, RPC>} rpcConnections - Map of peer IDs to RPC instances
   * @param {Map<string, Hyperdrive>} uploadDrives - Map of writable hyperdrives
   * @param {Map<string, Hyperdrive>} downloadDrives - Map of readable
   *  hyperdrives
   * @param {Object} inProgress - Map of in-progress downloads
   */
  constructor({
    store,
    log,
    watchPath,
    emitEvent,
    indexOpts,
    rpcConnections,
    uploadDrives,
    downloadDrives,
    inProgress = {},
  }) {
    this._store = store;
    this._emitEvent = emitEvent;
    this._indexOpts = indexOpts;
    this.#log = log;
    this.localIndex = new LocalFileIndex({
      store,
      log,
      watchPath,
      emitEvent: this._emitEvent,
      indexOpts,
      uploadDrives,
      downloadDrives,
    });
    /** @protected {Map<string, Hyperbee>} }All nonlocal PearDrives hyperbees */
    this.remoteIndexes = new Map();
    this.watchPath = watchPath;
    this._rpcConnections = rpcConnections;
    this._uploadDrives = uploadDrives;
    this._downloadDrives = downloadDrives;
    this._inProgress = inProgress;
  }

  //////////////////////////////////////////////////////////////////////////////
  // Public functions
  //////////////////////////////////////////////////////////////////////////////

  /**
   * Prepare the local index: ready, build initial index, and start polling.
   *
   * @returns {Promise<void>}
   */
  async ready() {
    this.#log.info("Getting IndexManager ready...");
    await this.localIndex.ready();
    this.localIndex.startPolling();
  }

  /**
   * Add a remote peer’s Hyperbee into this manager.
   * Subscribes to its append events so that on each new batch
   * you fire a NETWORK update back to PearDrive.
   *
   * @param {string} peerId – Hex string of the peer’s public key
   *
   * @param {Hyperbee} bee – An already–ready Hyperbee instance
   */
  async addBee(peerId, bee) {
    this.#log.info(`Adding remote index for peer ${peerId}`);

    // Add to index
    this.remoteIndexes.set(peerId, bee);

    // Emit network event if bee has data
    let hasInitialData = false;
    for await (const _ of bee.createReadStream({ limit: 1 })) {
      hasInitialData = true;
      break;
    }
    if (hasInitialData) {
      this.#log.info(`Remote index already has data for peer ${peerId}`);
      this._emitEvent(C.EVENT.NETWORK, peerId);
    }

    // Emit event on append
    bee.core.on("append", () => {
      this.#log.info(`Remote index updated for peer ${peerId}`);
      this._emitEvent(C.EVENT.NETWORK, {
        type: C.EVENT.NETWORK,
        peerId,
      });
    });
  }

  /**
   * Clean up when a peer disconnects by removing its Hyperbee.
   *
   * @param {string} peerId - Hex string identifier of the peer
   */
  handlePeerDisconnected(peerId) {
    this.remoteIndexes.delete(peerId);
    this.#log.info(`Remote index removed for peer ${peerId}`);
  }

  /** Get save data as JSON */
  getSaveData() {
    return {
      localFileIndexName: this.localIndex.name,
      watchPath: this.localIndex.watchPath,
      poll: this.localIndex.poll,
      pollInterval: this.localIndex.pollInterval,
    };
  }

  /** Get current local file index info */
  getLocalFileIndexInfo() {
    if (!this.localIndex.bee) {
      this.#log.error("Local index bee is not initialized.");
      throw new Error("Local index bee is not initialized.");
    }

    return {
      key: this.localIndex.getKey(),
      name: this.localIndex.name,
      watchPath: this.localIndex.watchPath,
    };
  }

  /** Close IndexManager gracefully */
  async close() {
    this.#log.info("Closing IndexManager...");
    await this.localIndex.close();

    // TODO finish closing hyperdrives
    this.#log.info("IndexManager closed.");
  }

  async getLocalIndexInfo() {
    return this.localIndex.getIndexInfo();
  }

  /**
   * Get file metadata / bee metadata for a given PearDrive
   *
   * @returns {
   *  Promise<Map<string, { key: HyperbeeKey, files: Object[] }>>
   * }
   */
  async getPearDriveIndexInfo(pdId) {
    this.#log.info(`Retrieving index info for peardrive ${pdId}...`);
    if (!this.remoteIndexes.has(pdId)) {
      this.#log.error(`No remote index found for peardrive ${pdId}`);
      throw new Error(`No remote index found for peardrive ${pdId}`);
    }

    const files = [];
    const bee = this.remoteIndexes.get(pdId);
    for await (const { _key, value } of bee.createReadStream()) {
      files.push(value);
    }

    return {
      key: bee.key,
      files,
    };
  }

  /**
   * Get file metadata / bee metadata for network, including self. There will
   * be a "local" entry for the local index and entries for each remote
   * peardrive with the keys being their hyperbee keys.
   *
   * @returns {
   *  Promise<Map<string, { key: HyperbeeKey, files: Object[] }>>
   * }
   */
  async getNetworkIndexInfo() {
    this.#log.info("Retrieving network index info...");

    if (this.remoteIndexes.size === 0) {
      this.#log.warn("No remote indexes available in network.");
      return new Map().set("local", await this.localIndex.getIndexInfo());
    }

    const networkInfo = await this.getNonlocalNetworkIndexInfo();
    const self = await this.localIndex.getIndexInfo();
    networkInfo.set("local", self);
    return networkInfo;
  }

  /** Get local file metadata and bee metadata for nonlocal peardrives */
  async getNonlocalNetworkIndexInfo() {
    this.#log.info("Retrieving nonlocal peardrive index info...");

    if (this.remoteIndexes.size === 0) {
      this.#log.warn("No remote indexes available in network.");
      return new Map();
    }

    const nonlocalInfo = new Map();
    for (const [pdId, bee] of this.remoteIndexes.entries()) {
      const files = [];
      for await (const { _key, value } of bee.createReadStream()) {
        files.push(value);
      }
      nonlocalInfo.set(pdId, { key: bee.key, files });
    }

    return nonlocalInfo;
  }

  /**
   * Create and configure the hyperdrive for uploading a file to a remote
   * peardrive.
   *
   * @param {string} path - Local file path to upload
   * @param {string | Uint8Array | ArrayBuffer} [driveKey] - Optional drive key.
   *  This should only be used when finishing an unfinished upload.
   *
   * @returns {Promise<string>} - Key to the writable hyperdrive
   */
  async createUploadDrive(path, driveKey) {
    this.#log.info(`Creating upload drive for file: ${path}`);

    // Ensure the path is found in the local index
    const fileInfo = await this.localIndex.getFileMetadata(path);
    if (!fileInfo) {
      this.#log.error(`File not found in local index: ${path}`);
      throw new Error(`File not found in local index: ${path}`);
    }

    // Create / load the hyperdrive
    let drive;
    if (driveKey) {
      const keyStr = utils.formatToStr(driveKey);
      this.#log.info(`Resuming upload with drive key: ${keyStr}`);
      const driveStore = this._createNamespace(path, "upload");
      drive = new Hyperdrive(driveStore, driveKey);
    } else {
      this.#log.info(`Creating new upload drive for file: ${path}`);
      drive = new Hyperdrive(this._store);
    }
    await drive.ready();
    this._uploadDrives.set(utils.asDrivePath(path), drive);

    // Load the drive with the file
    const absPath = utils.createAbsPath(path, this.watchPath);
    const data = fs.readFileSync(absPath);
    const drivePath = utils.asDrivePath(path);
    await drive.put(drivePath, data);

    this.#log.info(`Upload drive created for file: ${path}`);
    return drive.key;
  }

  /**
   * Create and configure the hyperdrive for downloading a file from a remote
   * peardrive.
   *
   * @param {string} path - Remote file path to download
   * @param {string | Uint8Array | ArrayBuffer} driveKey - Drive key.
   *
   * @returns {Promise<Hyperdrive>} - Readable hyperdrive
   */
  async createDownloadDrive(path, driveKey) {
    this.#log.info(`Creating download drive for file: ${path}`);

    try {
      // Create / load the hyperdrive
      const keyStr = utils.formatToStr(driveKey);
      const driveStore = this._createNamespace(path, "download");
      const drive = new Hyperdrive(driveStore, keyStr);
      await drive.ready();
      this._downloadDrives.set(utils.asDrivePath(path), drive);
      return drive;
    } catch (err) {
      this.#log.error(`Failed to create download drive for file: ${path}`, err);
      throw err;
    }
  }

  /**
   * Close and delete a download drive.
   *
   * @param {string} path - Local file path to close the download drive for
   *
   * @param {boolean} [force=false] - Whether to force close the drive
   *
   * @return {Promise<void>}
   */
  async closeDownloadDrive(path, force = false) {
    this.#log.info(`Closing download drive for file: ${path}`);

    const dPath = utils.asDrivePath(path);
    const drive = this._downloadDrives.get(dPath);
    if (!drive) {
      this.#log.warn(`No download drive found for file: ${path}`);
      return;
    }

    // Check if the drive is still in use
    if (this.hasActiveDownloads(dPath) && !force) {
      this.#log.warn(
        `Cannot close download drive for ${path} while downloads in progress`
      );
      return;
    }

    try {
      await drive.clearAll();
      await drive.close();
      this._downloadDrives.delete(dPath);
      this.#log.info(`Download drive closed for file: ${path}`);
    } catch (err) {
      this.#log.error(`Failed to close download drive for file: ${path}`, err);
      throw err;
    }
  }

  /**
   * Close and delete an upload drive.
   *
   * @param {string} path - Local file path to close the upload drive for
   *
   * @param {boolean} [force=false] - Whether to force close the drive
   *
   * @return {Promise<void>}
   */
  async closeUploadDrive(path, force = false) {
    this.#log.info(`Closing upload drive for file: ${path}`);

    const dPath = utils.asDrivePath(path);

    const drive = this._uploadDrives.get(dPath);
    if (!drive) {
      this.#log.warn(`No upload drive found for file: ${path}`);
      return;
    }

    // Check if the drive is still in use
    if (this.hasActiveUploads(dPath) && !force) {
      this.#log.warn(
        `Cannot close upload drive for ${path} while uploads in progress`
      );
      return;
    }

    try {
      await drive.clearAll();
      await drive.close();
      this._uploadDrives.delete(dPath);
      this.#log.info(`Upload drive closed for file: ${path}`);
    } catch (err) {
      this.#log.error(`Failed to close upload drive for file: ${path}`, err);
      throw err;
    }
  }

  /**
   * Execute a download from a given path through the corresponding upload
   * and download drives.
   *
   * @param {string} path - Local file path to download
   */
  async executeDownload(path) {
    this.#log.info(`Executing download for file: ${path}`);

    // Ensure download drive exists and has the file
    const downDrive = this._downloadDrives.get(utils.asDrivePath(path));
    if (downDrive === undefined) {
      this.#log.error(`No download drive found for file: ${path}`);
      throw new Error(`No download drive found for file: ${path}`);
    }

    try {
      this.#log.info(`Download starting for ${path}`);

      const readStream = downDrive.createReadStream(utils.asDrivePath(path), {
        timeout: 10000,
      });
      const writeStream = fs.createWriteStream(
        utils.createAbsPath(path, this.watchPath)
      );

      await new Promise((resolve, reject) => {
        writeStream.on("error", reject);
        readStream.on("error", reject);
        writeStream.on("close", () => {
          this.#log.info(`Download completed for ${path}`);
          resolve();
        });
        readStream.pipe(writeStream);
      });
    } catch (err) {
      this.#log.error(`Failed to execute download for file: ${path}`, err);
      throw err;
    }
  }

  /**
   * Check if a file path has active uploads/downloads
   *
   * @param {string} path - The file path to check
   *
   * @returns {boolean}
   */
  hasActiveTransfers(path) {
    const pathKey = utils.asDrivePath(path);
    return (
      !!this._inProgress[pathKey] &&
      Object.keys(this._inProgress[pathKey]).length > 0
    );
  }

  /**
   * Check if a file path has active uploads
   *
   * @param {string} path - The file path to check
   *
   * @returns {boolean}
   */
  hasActiveUploads(path) {
    const pathKey = utils.asDrivePath(path);
    return (
      !!this._inProgress[pathKey] &&
      Object.values(this._inProgress[pathKey]).some(
        (entry) => entry.direction === "upload"
      )
    );
  }

  /**
   * Check if a file path has active downloads
   *
   * @param {string} path - The file path to check
   *
   * @returns {boolean}
   */
  hasActiveDownloads(path) {
    const pathKey = utils.asDrivePath(path);
    return (
      !!this._inProgress[pathKey] &&
      Object.values(this._inProgress[pathKey]).some(
        (entry) => entry.direction === "download"
      )
    );
  }

  /**
   * Mark a transfer occurring
   *
   * @param {string} path - The file path being transferred
   * @param {string} direction - The direction of the transfer ("upload" or
   *  "download")
   * @param {string | Uint8Array | ArrayBuffer} peerId - The ID of the peer
   *  involved in the transfer
   */
  markTransfer(path, direction, peerId) {
    this.#log.debug(
      `Marking transfer for ${path} (${direction}) with peer 
      ${utils.formatToStr(peerId)}`
    );
    const pathKey = utils.asDrivePath(path);
    const tmpEntries =
      this._inProgress[pathKey] ||
      (this._inProgress[pathKey] = Object.create(null));
    const tmpEntry = { direction, startedAt: Date.now() };
    this._inProgress[pathKey][utils.formatToStr(peerId)] = tmpEntry;
  }

  /**
   * Unmark a transfer that has completed
   *
   * @param {string} path - The file path that was transferred
   * @param {string} direction - The direction of the transfer ("upload" or
   * "download")
   * @param {string | Uint8Array | ArrayBuffer} peerId - The ID of the peer
   * involved in the transfer
   */
  async unmarkTransfer(path, direction, peerId) {
    this.#log.debug(
      `Unmarking transfer for ${path} (${direction}) with peer 
      ${utils.formatToStr(peerId)}`
    );

    const pathKey = utils.asDrivePath(path);
    if (!this._inProgress[pathKey]) {
      this.#log.warn(
        `No in-progress transfers found for ${path} (${direction}) with peer 
        ${utils.formatToStr(peerId)}`
      );
      return;
    }

    delete this._inProgress[pathKey][utils.formatToStr(peerId)];

    if (Object.keys(this._inProgress[pathKey]).length === 0) {
      delete this._inProgress[pathKey];
      this.#log.debug(`All transfers for ${path} completed, closing drive`);
      if (direction === "download") {
        await this.closeDownloadDrive(path, true);
      }
      if (direction === "upload") {
        await this.closeUploadDrive(path, true);
      }
    } else {
      this.#log.debug(`Transfers still in progress for ${path}`);
    }

    this.#log.info(`Transfer for ${path} (${direction}) with peer 
      ${utils.formatToStr(peerId)} unmarked`);
  }

  //////////////////////////////////////////////////////////////////////////////
  // Private functions
  //////////////////////////////////////////////////////////////////////////////

  /**
   * Create corestore namespace for a drive
   *
   * @param {string} pathOrKey - The path or key to create the namespace for
   *
   * @param {string} [tag] - Optional tag for the namespace
   */
  _createNamespace(pathOrKey, tag) {
    const key = utils.formatToStr(pathOrKey);
    this.#log.debug(`Creating namespace for drive: ${pathOrKey}`);

    const tagStr = `${tag}:` || "";
    const storePath = `${tagStr}${key}`;
    return this._store.namespace(storePath);
  }
}
