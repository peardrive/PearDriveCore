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

  /**
   * @param {Object} opts
   *    @param {Corestore} opts.store - Corestore instance for managing
   *      Hypercores
   *    @param {Logger} opts.log - Logger for informational output
   *    @param {string} opts.watchPath - Path to watch for local files
   *    @param {any} opts.emitEvent - Function to emit events
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
   */
  constructor({
    store,
    log,
    watchPath,
    emitEvent,
    indexOpts,
    rpcConnections,
    uploads,
    downloads,
    inProgress = {},
    sendFileRequest,
    sendFileRelease,
  }) {
    super();

    this._store = store.namespace("peardrive:indexmanager");
    this._emitEvent = emitEvent;
    this._indexOpts = indexOpts;
    this.#log = log;
    this.localIndex = new LocalFileIndex({
      store,
      log,
      watchPath,
      emitEvent: this._emitEvent,
      indexOpts,
      uploads,
      downloads,
    });
    /** @protected {Map<string, Hyperbee>} }All nonlocal PearDrives hyperbees */
    this.remoteIndexes = new Map();
    this.watchPath = watchPath;
    this._rpcConnections = rpcConnections;
    this._uploads = uploads;
    this._downloads = downloads;
    this._inProgress = inProgress;
    this._sendFileRequest = sendFileRequest;
    this._sendFileRelease = sendFileRelease;
  }

  //////////////////////////////////////////////////////////////////////////////
  // Getters
  //////////////////////////////////////////////////////////////////////////////

  get relay() {
    return this._indexOpts.relay;
  }

  get relayInterval() {
    return this._indexOpts.pollInterval;
  }

  //////////////////////////////////////////////////////////////////////////////
  // Public functions
  //////////////////////////////////////////////////////////////////////////////

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
      ws.on("error", reject);
      rs.on("error", reject);
      ws.on("finish", () => resolve(ws.id));
      rs.pipe(ws);
    });

    // Track as "upload in progress" for busy-file semantics
    this._uploads.set(dPath, { store, core, blobs, id, type: "hyperblobs" });

    this.#log.info(`Upload blob ready for ${filePath}`);
    return { key: core.key, id };
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
   *  Create and configure download blob, a Hyperblobs instance, for a file from
   *  a remote peer.
   *
   * @param {string} filePath
   * @param {string | Uint8Array | ArrayBuffer} coreKey
   *
   * @returns {Promise<void>}
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
   * @param {string} filePath
   * @param {string | Uint8Array | ArrayBuffer} id
   */
  async _executeDownloadBlob(filePath, id) {
    this.#log.info(`Executing Hyperblobs download for: ${filePath}`);

    // Get / validate download blob
    const download = this._downloads.get(utils.asDrivePath(filePath));
    if (!download) {
      this.#log.error(`No download blob found for file: ${filePath}`);
      throw new Error(`No download blob found for file: ${filePath}`);
    }

    // Create read/write streams from hyperblobs to local file
    const { blobs } = download;
    const readStream = blobs.createReadStream(id, {
      wait: true,
      timeout: 10000,
    });
    const writeStream = fs.createWriteStream(
      utils.createAbsPath(filePath, this.watchPath)
    );

    try {
      await new Promise((resolve, reject) => {
        writeStream.on("error", reject);
        readStream.on("error", reject);
        writeStream.on("close", resolve);
        readStream.pipe(writeStream);
      });
    } catch (err) {
      this.#log.error(
        `Failed to execute Hyperblobs download for file: ${filePath}`,
        err
      );
      throw err;
    }
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

  async _open() {
    this.#log.info("Opening IndexManager...");

    await this.localIndex.ready();
    if (this.relay) this.startRelay();
    if (this._indexOpts.poll) this.localIndex.startPolling();

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
