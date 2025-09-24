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
import Hyperblobs from "hyperblobs";
import fs from "fs";
import ReadyResource from "ready-resource";

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
export class IndexManager extends ReadyResource {
  /** @private {Corestore} */
  _store;
  /** @private {Logger} */
  #log;
  /** Relayer interval function */
  #relayer = null;
  /** whether relay function is currently running */
  #relayRunning = false;
  /** @private {Array<string>} Queued downloads */
  #queuedDownloads = [];

  /**
   * @param {Object} opts
   *    @param {Corestore} opts.store - Corestore instance for managing
   *      Hypercores
   *    @param {Logger} opts.log - Logger for informational output
   *    @param {string} opts.watchPath - Path to watch for local files
   *    @param {Object} opts.indexOpts - Options for the local file index
   *    @param {Map<string, RPC>} opts.rpcConnections - Map of peer IDs to RPC
   *      instances
   *    @param {Map<string, Hyperdrive>} opts.uploads - Map of upload drives and
   *      corestore subspaces
   *    @param {Map<string, Hyperdrive>} opts.downloads - Map of download drives
   *      and corestore subspaces
   *    @param {Object} opts.inProgress - Map of in-progress downloads
   *    @param {Function} opts.sendFileRequest - Function to request a file from
   *      a peer
   *    @param {Function} opts.sendFileRelease- Function to release a file after
   *      download/upload
   *    @param {Array<string>} [opts.unfinishedDownloads] - List of filePaths
   *      for unfinished downloads to process and queue on startup
   */
  constructor({
    store,
    log,
    watchPath,
    indexOpts,
    rpcConnections,
    uploads,
    downloads,
    inProgress = {},
    sendFileRequest,
    sendFileRelease,
    queuedDownloads = [],
  }) {
    super();

    this._store = store.namespace("peardrive:indexmanager");
    this._indexOpts = indexOpts;
    this.#log = log;
    this.localIndex = new LocalFileIndex({
      store,
      log,
      watchPath,
      indexOpts,
      uploads,
      downloads,
    });
    /** @protected {Map<string, Hyperbee>} All nonlocal PearDrives hyperbees */
    this.remoteIndexes = new Map();
    /**
     * @private {Map<string, number>} previous read (version, length) per peer
     */
    this._peerUpdates = new Map();
    this.watchPath = watchPath;
    this._rpcConnections = rpcConnections;
    this._uploads = uploads;
    this._downloads = downloads;
    this._inProgress = inProgress;
    this._sendFileRequest = sendFileRequest;
    this._sendFileRelease = sendFileRelease;
    this.#queuedDownloads = new Set(queuedDownloads);
  }

  //////////////////////////////////////////////////////////////////////////////
  // Getters
  //////////////////////////////////////////////////////////////////////////////

  /** Get boolean for whether or not relay is enabled */
  get relay() {
    return this._indexOpts.relay;
  }

  /** Get the interval for relay polling */
  get relayInterval() {
    return this._indexOpts.pollInterval;
  }

  /** Get the array of downloads in queue */
  get queuedDownloads() {
    return Array.from(this.#queuedDownloads);
  }

  //////////////////////////////////////////////////////////////////////////////
  // Public functions
  //////////////////////////////////////////////////////////////////////////////

  /**
   * Add a file to the download queue.
   *
   * @param {string} filePath - The file path to queue for download
   *
   * @returns {void}
   *
   * @throws {Error} If IndexManager is not opened
   */
  queueDownload(filePath) {
    // This should only be called when the IndexManager is open
    if (!this.opened) {
      this.#log.error("Cannot queue download; IndexManager is not opened yet.");
      throw new Error("IndexManager is not opened yet.");
    }

    const dPath = utils.asDrivePath(filePath);
    if (this.#queuedDownloads.has(dPath)) {
      this.#log.warn(`File already queued for download: ${filePath}`);
      return;
    }
    this.#queuedDownloads.add(dPath);
  }

  /**
   * Start relay mode, which periodically scans the network for files not
   * present on the local index and automatically downloads them.
   */
  startRelay() {
    if (this.#relayer || this.#relayRunning) return;
    this.#log.info("Starting relay mode...");

    this.#relay();
  }

  /** Stop relay mode */
  stopRelay() {
    this._indexOpts.relay = false;
    if (!this.#relayer) {
      this.#log.warn("Relay mode is not currently active.");
      return;
    }

    this.#log.info("Stopping relay mode...");
    clearInterval(this.#relayer);
    this.#relayer = null;
    this.#log.info("Relay mode stopped.");
  }

  /**
   * Add a remote peer’s Hyperbee into this manager.
   * Subscribes to its append events so that on each new batch
   * you fire a NETWORK update back to PearDrive.
   *
   * @param {string} peerId – Hex string of the peer’s public key
   * @param {Hyperbee} bee – An already–ready Hyperbee instance
   */
  async addBee(peerId, bee) {
    this.#log.info(`Adding remote index for peer ${peerId}`);

    // Add to index
    this.remoteIndexes.set(peerId, bee);

    // Initialize the snapshot update for this peer
    await bee.core.update();
    const initialUpdate = bee.version;
    this._peerUpdates.set(peerId, initialUpdate);

    // Emit network event if bee has data
    let hasInitialData = false;
    for await (const _ of bee.createReadStream({ limit: 1 })) {
      hasInitialData = true;
      break;
    }
    if (hasInitialData) {
      this.#log.info(`Remote index already has data for peer ${peerId}`);
      // this._emitEvent(C.EVENT.NETWORK, peerId);
    }

    // Emit event on append
    bee.core.on("append", async () => {
      this.#log.info(`Remote index updated for peer ${peerId}`);
      try {
        await this.#onPeerUpdate(peerId);
      } catch (error) {
        this.#log.error(
          `Error updating remote index for peer ${peerId}: ${error}`
        );
      }
      // this._emitEvent(C.EVENT.NETWORK, {
      //   type: C.EVENT.NETWORK,
      //   peerId,
      // });
    });
  }

  /**
   * Clean up when a peer disconnects by removing its Hyperbee.
   *
   * @param {string} peerId - Hex string identifier of the peer
   */
  handlePeerDisconnected(peerId) {
    this.remoteIndexes.delete(peerId);
    this._peerUpdates.delete(peerId);
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
   * Create a Hyperblobs-backed transfer core and stream the file into it.
   * Returns { key, id } where `key` is the Hypercore pubkey and `id` is the
   * Hyperblobs id.
   *
   * @param {string} filePath - Local file path to upload
   *
   * @returns {Promise<{ key: string, id: string }>} - Key to the writable
   *    hypercore and blob id
   */
  async createUploadBlob(filePath) {
    this.#log.info(`Creating upload blob for file: ${filePath}`);

    // Ensure it exists in local index
    const fileInfo = await this.localIndex.getFileMetadata(filePath);
    if (!fileInfo) {
      this.#log.error(`File not found in local index: ${filePath}`);
      throw new Error(`File not found in local index: ${filePath}`);
    }

    const dPath = utils.asDrivePath(filePath);
    const store = this._createNamespace(filePath, "upload:blobs");
    await store.ready();

    // Dedicated core for this single-blob transfer
    const core = store.get({ name: "blob" });
    await core.ready();

    const blobs = new Hyperblobs(core);

    // Stream file into blobs (no buffering entire file)
    const absPath = utils.createAbsPath(filePath, this.watchPath);
    const rs = fs.createReadStream(absPath);
    const ws = blobs.createWriteStream();

    const id = await new Promise((resolve, reject) => {
      let settled = false;

      const done = () => {
        if (settled) return;
        settled = true;
        resolve(ws.id);
      };

      const fail = (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      ws.once("close", done);
      ws.once("error", fail);
      rs.once("error", fail);
      rs.pipe(ws);
    });

    // Track as "upload in progress" for busy-file semantics
    this._uploads.set(dPath, { store, core, blobs, id, type: "hyperblobs" });

    this.#log.info(`Upload blob ready for ${filePath}`);
    const blobData = {
      type: "hyperblobs",
      key: utils.formatToStr(core.key),
      id,
    };
    return blobData;
  }

  /**
   * Given a peer ID, hyperblobs key for the upload, and the file path, handle
   * the download process.
   *
   * @param {string | Uint8Array | ArrayBuffer} peerId
   * @param {string} filePath
   * @param {{
   *    type: "hyperblobs", key: string | Uint8Array, id: object
   * }} downloadRef
   *
   * @returns {Promise<boolean>} - Success flag
   */
  async handleDownload(peerId, filePath, downloadRef) {
    this.#log.info(`Handling download for ${filePath} from peer ${peerId}`);

    // Expect new Hyperblobs ref
    const isValidBlobsRef =
      downloadRef &&
      typeof downloadRef === "object" &&
      downloadRef.type === "hyperblobs";
    if (!isValidBlobsRef) {
      this.#log.error(
        "Expected a Hyperblobs downloadRef { type:'hyperblobs', key, id }"
      );
      throw new Error("Invalid download reference (expected Hyperblobs)");
    }

    try {
      this.markTransfer(filePath, "download", peerId);
      await this._createDownloadBlob(filePath, downloadRef.key);
      await this._executeDownloadBlob(filePath, downloadRef.id);
    } catch (err) {
      this.#log.error(
        `Download process failed for file: ${filePath} from peer ${peerId}`,
        err
      );
      return false;
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
   *
   * @returns {void}
   */
  markTransfer(path, direction, peerId) {
    this.#log.debug(
      `Marking transfer for ${path} (${direction}) with peer 
      ${utils.formatToStr(peerId)}`
    );
    try {
      const pathKey = utils.asDrivePath(path);

      // Add to in-progress dictionary object, prevent duplicates
      const tmpEntries = this._inProgress[pathKey];
      if (!tmpEntries) {
        this._inProgress[pathKey] = {};
      } else if (tmpEntries[utils.formatToStr(peerId)]) {
        this.#log.warn(
          `Transfer already marked for ${path} (${direction}) with peer 
          ${utils.formatToStr(peerId)}`
        );
        return;
      }
      const tmpEntry = { direction, startedAt: Date.now() };
      this._inProgress[pathKey][utils.formatToStr(peerId)] = tmpEntry;

      // Emit event
      this.emit(C.IM_EVENT.IN_PROGRESS_DOWNLOAD_STARTED, { path, peerId });
    } catch (err) {
      this.#log.error("Error marking transfer", err);
    }
  }

  /**
   * Unmark a transfer that has completed
   *
   * @param {string} path - The file path that was transferred
   * @param {string} direction - The direction of the transfer ("upload" or
   * "download")
   * @param {string | Uint8Array | ArrayBuffer} peerId - The ID of the peer
   * involved in the transfer
   *
   * @returns {Promise<void>}
   */
  async unmarkTransfer(path, direction, peerId) {
    this.#log.debug(
      `Unmarking transfer for ${path} (${direction}) with peer 
      ${utils.formatToStr(peerId)}`
    );

    // Ensure this transfer exists
    const pathKey = utils.asDrivePath(path);
    if (!this._inProgress[pathKey]) {
      this.#log.warn(
        `No in-progress transfers found for ${path} (${direction}) with peer 
        ${utils.formatToStr(peerId)}`
      );
      return;
    }

    // Delete the specific peer transfer entry
    delete this._inProgress[pathKey][utils.formatToStr(peerId)];

    // Emit event, if a download
    if (direction === "download") {
      this.emit(C.IM_EVENT.IN_PROGRESS_DOWNLOAD_COMPLETED, { path, peerId });
    }

    // Delete the entire path entry if no more transfers active
    if (Object.keys(this._inProgress[pathKey]).length === 0) {
      delete this._inProgress[pathKey];
      this.#log.debug(`All transfers for ${path} completed, closing drive`);
      if (direction === "download") {
        await this.closeDownloadBlob(path, true);
      }
      if (direction === "upload") {
        await this.closeUploadBlob(path, true);
      }
    } else {
      this.#log.debug(`Transfers still in progress for ${path}`);
    }

    this.#log.info(`Transfer for ${path} (${direction}) with peer 
      ${utils.formatToStr(peerId)} unmarked`);
  }

  /**
   * Tear down and delete a download blob for a given file path
   *
   * @param {string} path - Local file path to close the download blob for
   * @param {boolean} [force=false] - Whether to force close the blob even if
   * transfers active
   *
   * @returns {Promise<void>}
   */
  async closeDownloadBlob(path, force = false) {
    this.#log.info(`Closing download blob for file: ${path}`);
    const dPath = utils.asDrivePath(path);
    const download = this._downloads.get(dPath);

    if (!download) {
      this.#log.warn(`No download blob found for file: ${path}`);
      return;
    }

    if (this.hasActiveDownloads(dPath) && !force) {
      this.#log.warn(
        `Cannot close download blob for ${path} while downloads in progress`
      );
      return;
    }

    try {
      // Optional: free the blob itself if you want to reclaim space
      if (download.id && download.blobs) {
        await download.blobs.clear(download.id).catch((err) => {
          this.#log.debug(`Failed to clear blob data for ${path}`, err);
        });
      }

      if (download.core) {
        await download.core.close();
      }
      this.#log.info(`Download blob closed for file: ${path}`);
    } catch (err) {
      this.#log.error(`Failed to close download blob for file: ${path}`, err);
      throw err;
    } finally {
      this._downloads.delete(dPath);
    }
  }

  /**
   * Tear down and delete an upload blob for a given file path
   *
   * @param {string} path - Local file path to close the upload blob for
   * @param {boolean} [force=false] - Whether to force close the blob even if
   * transfers active
   *
   * @returns {Promise<void>}
   */
  async closeUploadBlob(path, force = false) {
    this.#log.info(`Closing upload blob for file: ${path}`);
    const dPath = utils.asDrivePath(path);
    const upload = this._uploads.get(dPath);

    if (!upload) {
      this.#log.warn(`No upload blob found for file: ${path}`);
      return;
    }

    if (this.hasActiveUploads(dPath) && !force) {
      this.#log.warn(
        `Cannot close upload blob for ${path} while uploads in progress`
      );
      return;
    }

    try {
      if (upload.id && upload.blobs) {
        await upload.blobs.clear(upload.id).catch((err) => {
          this.#log.debug(`Failed to clear upload blob data for ${path}`, err);
        });
      }

      if (upload.core) {
        await upload.core.close();
      }
      this.#log.info(`Upload blob closed for file: ${path}`);
    } catch (err) {
      this.#log.error(`Failed to close upload blob for file: ${path}`, err);
      throw err;
    } finally {
      this._uploads.delete(dPath);
    }
  }

  //////////////////////////////////////////////////////////////////////////////
  // Private functions
  //////////////////////////////////////////////////////////////////////////////

  /**
   *  Create and configure download blob, a Hyperblobs instance, for a file from
   *  a remote peer.
   *
   * @param {string} filePath
   * @param {string | Uint8Array | ArrayBuffer} coreKey
   *
   * @returns {Promise<void>}
   *
   * @private
   */
  async _createDownloadBlob(filePath, coreKey) {
    this.#log.info(`Creating download blob for file: ${filePath}`);

    const keyBuf = utils.formatToBuffer(coreKey);
    const store = this._createNamespace(filePath, "download:blobs");
    await store.ready();

    const core = store.get({ key: keyBuf });
    await core.ready();

    const blobs = new Hyperblobs(core);
    this._downloads.set(utils.asDrivePath(filePath), {
      store,
      core,
      blobs,
      type: "hyperblobs",
    });
  }

  /**
   * Execute a download of a blob from a Hyperblobs instance to the local file
   *
   * @param {string} filePath - File path to download from
   * @param {Object} id - The ID of the blob to download
   *
   * @returns {Promise<void>}
   *
   * @private
   */
  async _executeDownloadBlob(filePath, id) {
    this.#log.info(`Executing Hyperblobs download for: ${filePath}`);

    const download = this._downloads.get(utils.asDrivePath(filePath));
    const { blobs } = download;
    if (!download) {
      this.#log.error(`No download blob found for file: ${filePath}`);
      throw new Error(`No download blob found for file: ${filePath}`);
    }

    // Create read/write streams
    const rs = blobs.createReadStream(id, {
      wait: true,
      timeout: 0,
    });
    const ws = fs.createWriteStream(
      utils.createAbsPath(filePath, this.watchPath)
    );

    // Monitor progress
    const totalBytes = id.byteLength;
    let downloadedBytes = 0;

    // Activity timer for managing timeouts
    let inactivityTimer = null;
    let INACTIVITY_TIMEOUT = 30000; // 30 seconds of inactivity to timeout
    /** Reset inactivity timer (on data) */
    const resetInactivityTimer = () => {
      if (inactivityTimer) {
        clearTimeout(inactivityTimer);
      }
      inactivityTimer = setTimeout(() => {
        const error = new Error(
          "Download timed out due to inactivity" +
            `(${downloadedBytes}/${totalBytes} bytes received)`
        );
        rs.destroy(error);
        ws.destroy(error);
      }, INACTIVITY_TIMEOUT);
    };

    // Configure read/write stream events, execute download
    await new Promise((resolve, reject) => {
      // Start the inactivity timer
      resetInactivityTimer();

      ws.once("error", (err) => {
        if (inactivityTimer) clearTimeout(inactivityTimer);
        reject(err);
      });

      rs.once("error", (err) => {
        if (inactivityTimer) clearTimeout(inactivityTimer);
        reject(err);
      });

      let prevPercent = 0;

      rs.on("data", (chunk) => {
        downloadedBytes += chunk.length;

        // Reset inactivity timer on every data chunk
        resetInactivityTimer();

        // Log Download Progress
        const curPercent = Math.floor((downloadedBytes / totalBytes) * 100);
        if (curPercent >= prevPercent + 1) {
          // Log every 1% by checking against lastLoggedPercent
          const mbDownloaded = Math.round(downloadedBytes / 1024 / 1024);
          const mbTotal = Math.round(totalBytes / 1024 / 1024);
          this.#log.debug(
            `Download progress: ${curPercent}% (${mbDownloaded}MB/${mbTotal}MB)`
          );
          prevPercent = curPercent;
        }
      });

      ws.once("close", () => {
        if (inactivityTimer) clearTimeout(inactivityTimer);

        if (downloadedBytes !== totalBytes) {
          reject(
            new Error(
              `Incomplete download: ${downloadedBytes}/${totalBytes} bytes`
            )
          );
        } else {
          this.#log.info(
            `Download complete and verified: ${downloadedBytes} bytes`
          );
          resolve();
        }
      });

      rs.pipe(ws);
    });
  }

  /**
   * Create corestore namespace for a drive
   *
   * @param {string} pathOrKey - The path or key to create the namespace for
   *
   * @param {string} [tag] - Optional tag for the namespace
   *
   * @private
   */
  _createNamespace(pathOrKey, tag) {
    const key = utils.formatToStr(pathOrKey);
    this.#log.debug(`Creating namespace for drive: ${pathOrKey}`);

    const tagStr = `${tag}:` || "";
    const storePath = `${tagStr}${key}`;
    return this._store.namespace(storePath);
  }

  /**
   * Execute a download from the relay. Mirrors the PearDrive
   * 'DownloadFileFromPeer' functionality.
   *
   * @param {string | Uint8Array | ArrayBuffer} peerId - Peer ID to download
   *   from
   * @param {string} fileKey - Key of the file to download
   *
   * @returns {Promise<void>}
   *
   * @private
   */
  async _relayDownload(peerId, fileKey) {
    this.#log.info(`Relay: Downloading file ${fileKey} from peer ${peerId}`);

    try {
      // Get Hyperblobs ref from peer
      const ref = await this._sendFileRequest(peerId, fileKey);
      if (!ref || ref.type !== "hyperblobs" || !ref.key || !ref.id) {
        this.#log.warn(
          `Relay: Invalid Hyperblobs ref for ${fileKey} from ${peerId}`
        );
        return;
      }

      await this.handleDownload(peerId, fileKey, ref);
      await this.unmarkTransfer(fileKey, "download", peerId);
      await this._sendFileRelease(peerId, fileKey);
    } catch (err) {
      this.#log.error(
        `Relay: Error downloading file ${fileKey} from peer ${peerId}`,
        err
      );
      throw err;
    }
  }

  /**
   * Wrapper for relay logic that ensures it runs safely
   *
   * @private
   */
  async #relay() {
    if (this.#relayRunning || !this._indexOpts.relay) {
      this.#log.warn("Relay is already running, skipping this iteration.");
      return;
    }

    this.#log.info("Scanning for new files to relay...");
    this.#relayRunning = true;

    try {
      // Make sure local index is ready
      // TODO: Polling stuff should be ready if localIndex.opened
      await this.localIndex.pollOnce();
      // Create set of all local files
      const localFiles = new Set();
      for await (const { key } of this.localIndex.bee.createReadStream()) {
        localFiles.add(utils.formatToStr(key));
      }

      // Iterate over each peer to find missing files in the local index
      const missingFiles = new Map();
      for (const [peerId, bee] of this.remoteIndexes.entries()) {
        this.#log.debug(`Checking remote index for peer ${peerId}`);

        // Check each file in the peer's index
        for await (const { key } of bee.createReadStream()) {
          const fileKey = utils.formatToStr(key);
          if (!localFiles.has(fileKey)) {
            missingFiles.set(fileKey, peerId);
          }
        }
      }

      // Download the first entry that is missing
      if (missingFiles.size > 0) {
        const [fileKey, peerId] = missingFiles.entries().next().value;
        await this._relayDownload(peerId, fileKey);
      }
    } catch (err) {
      this.#log.error("Error during relay operation", err);
    } finally {
      this.#relayRunning = false;
      // Set the timer for the next relay
      this.#relayer = setTimeout(
        () => this.#relay(),
        this._indexOpts.pollInterval * 3
      );
    }
  }

  /** Handle peer bee appends */
  async #onPeerUpdate(peerId) {
    this.#log.info(`Peer ${peerId} updated`);

    // Get bee
    const bee = this.remoteIndexes.get(peerId);
    if (!bee) {
      this.#log.warn(`Peer ${peerId} not found`);
      return;
    }
    await bee.core.update();

    // Previous snapshot update
    const prevUpdate = this._peerUpdates.get(peerId) ?? 0;

    // If called without an update, noop
    const curUpdate = bee.version;
    if (curUpdate === prevUpdate) return;

    // Create snapshot at previous head
    const prevSnap = bee.checkout(prevUpdate);

    // Diff current (bee) vs previous snapshot
    for await (const entry of bee.createDiffStream(prevSnap, {
      keys: true,
      values: true,
    })) {
      // Parse diff stream data for file path
      const keySide = entry.right ?? entry.left;
      if (!keySide || typeof keySide.key === "undefined") {
        this.#log.warn("Diff entry missing key; skipping", entry?.type);
        continue;
      }
      const filePath = keySide.key;
      const peerKey = utils.formatToStr(bee.key);

      // Diff stream values
      const curVal = entry.left?.value ?? null; // current
      const prevVal = entry.right?.value ?? null; // previous

      // Determine if this is a file addition, deletion or change
      let updateType = null;
      if (curVal && prevVal) {
        updateType = "changed";
      } else if (curVal && !prevVal) {
        updateType = "added";
      } else if (!curVal && prevVal) {
        updateType = "removed";
      }

      // If an updateType cannot be determined (this shouldn't ever happen)
      if (!updateType) {
        this.#log.warn("Could not determine update type. skipping:", entry);
        return;
      }

      // Handle file addition
      if (updateType === "added") {
        // Emit file added event
        this.emit(C.IM_EVENT.PEER_FILE_ADDED, {
          filePath,
          peerKey: peerId,
          hash: curVal.hash,
        });

        // Check if this file is queued for download
        const dPath = utils.asDrivePath(filePath);
        if (this.#queuedDownloads.has(dPath))
          this.#handleQueuedDownload(peerId, filePath);
      }

      // Handle file change
      if (updateType === "changed") {
        // Make sure hashes have changed. If not, noop
        const hash = curVal.hash;
        const prevHash = prevVal.hash;
        if (hash === prevHash) return;

        this.emit(C.IM_EVENT.PEER_FILE_CHANGED, {
          filePath,
          peerKey: peerId,
          hash: curVal.hash,
          prevHash: prevVal.hash,
        });
      }

      // Handle file removal
      if (updateType === "removed") {
        this.emit(C.IM_EVENT.PEER_FILE_REMOVED, {
          filePath,
          peerKey: peerId,
        });
      }
    }

    // Advance snapshot head
    this._peerUpdates.set(peerId, curUpdate);
  }

  /**
   *
   * @param {string} peerId
   * @param {string} filePath
   */
  async #handleQueuedDownload(peerId, filePath) {
    // Ensure this file is still queued
    const dPath = utils.asDrivePath(filePath);
    if (this.#queuedDownloads.has(dPath)) {
      this.#log.info(
        `File ${filePath} is queued for download; starting download...`
      );
    }

    // Remove from queue
    this.#queuedDownloads.delete(dPath);

    try {
      // Get Hyperblobs ref from peer
      const ref = await this._sendFileRequest(peerId, filePath);
      if (!ref || ref.type !== "hyperblobs" || !ref.key || !ref.id) {
        this.#log.warn(
          `Relay: Invalid Hyperblobs ref for ${filePath} from ${peerId}`
        );
        return;
      }

      await this.handleDownload(peerId, filePath, ref);
      await this.unmarkTransfer(filePath, "download", peerId);
      await this._sendFileRelease(peerId, filePath);
    } catch (err) {
      this.#log.error(`Error handling queued download for ${filePath}`, err);
    }
  }

  //////////////////////////////////////////////////////////////////////////////
  // Lifecycle methods
  //////////////////////////////////////////////////////////////////////////////

  async _open() {
    this.#log.info("Opening IndexManager...");

    // Local index initialization
    await this.localIndex.ready();

    // Wire up LFI event listeners
    this.localIndex.on(C.LFI_EVENT.FILE_ADDED, (data) => {
      this.emit(C.IM_EVENT.LOCAL_FILE_ADDED, data);
    });
    this.localIndex.on(C.LFI_EVENT.FILE_REMOVED, (data) => {
      this.emit(C.IM_EVENT.LOCAL_FILE_REMOVED, data);
    });
    this.localIndex.on(C.LFI_EVENT.FILE_CHANGED, (data) => {
      this.emit(C.IM_EVENT.LOCAL_FILE_CHANGED, data);
    });

    // Relay initialization
    if (this.relay) this.startRelay();

    this.#log.info("IndexManager opened successfully!");
  }

  async _close() {
    this.#log.info("Closing IndexManager...");

    await this.localIndex.close();

    for (const [peerId, bee] of this.remoteIndexes.entries()) {
      this.#log.debug(`Closing remote index for peer ${peerId}`);
      await bee.close();
      this.remoteIndexes.delete(peerId);
    }

    for (const [dPath, { drive }] of this._uploads.entries()) {
      this.#log.debug(`Closing upload drive for ${dPath}`);
      await drive.close();
    }

    for (const [dPath, { drive }] of this._downloads.entries()) {
      this.#log.debug(`Closing download drive for ${dPath}`);
      await drive.close();
    }

    this.#log.info("IndexManager closed successfully!");
  }
}
