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
 * @remarks P2P networking system for node.js applications.
 */

import Hyperswarm from "hyperswarm";
import Corestore from "corestore";
import RPC from "protomux-rpc";
import c from "compact-encoding";
import Hyperbee from "hyperbee";
import Logger from "@hopets/logger";
import ReadyResource from "ready-resource";

import * as C from "./constants.js";
import * as utils from "./utils/index.js";
import { IndexManager } from "./IndexManager.js";

/** The utils toolbox PearDrive Core uses */
export const lib = utils;

/** Built-in events, attach callbacks to these events with the on() function */
export const EVENT = C.EVENT;

/** RPC event names PearDrive Core uses */
export const RPC_EVENT = C.RPC;

/*******************************************************************************
 * PearDrive Core
 * ---
 * P2P networking system for node.js applications.
 ******************************************************************************/
export default class PearDrive extends ReadyResource {
  /** @private {Logger} Logger */
  #log;
  /** @private {Hyperswarm} Hyperswarm for all nodes on network */
  _swarm;
  /** @private {Corestore} Corestore for all hypercores */
  _store;
  /** @private {Map<string, RPC>} RPC PearDrive connections */
  _rpcConnections;
  /** @private {IndexManager} Index manager for watching network/local files */
  #im;
  /** @private {string} Absolute path to corestore */
  _corestorePath;
  /** @private {string} Path to PearDrive's local file storage */
  _watchPath;
  /** @private {string} Name of the local indexer */
  _indexName;
  /** @private Stored indexer options */
  _indexOpts;
  /** @private Stored hyperswarm options */
  _swarmOpts;
  /** @private Logger options */
  _logOpts;
  /** @protected {Map} Map of download blobs and corestore subspaces*/
  _downloads;
  /** @protected {Map} Map of upload blobs and corestore subspaces */
  _uploads;
  /** @private {Object} In-progress downloads meta-data */
  _inProgress;
  /** @private {ArrayBuffer | Uint8Array} - Hyperswarm topic buffer */
  _networkKey;
  /** @private {Object} - Holds custom message hooks */
  _customMessageHooks = {};
  /** @private {Object} - Holds custom message hooks for one-time exec */
  _onceCustomMessageHooks = {};

  /**
   * @param {Object} opts
   *    @param {string}  opts.corestorePath - Filesystem path for corestore data
   *    @param {string}  opts.watchPath - Path to watch for local files
   *    @param {string}  [opts.indexName] - Name of the local file index core
   *    @param {Object}  [opts.swarmOpts]   - Options passed to Hyperswarm
   *    @param {Array<string|Buffer|Uint8Array>} [opts.swarmOpts.bootstrap] -
   *      DHT bootstrap list for peer discovery.
   *    @param {Uint8Array|Buffer|string} [opts.swarmOpts.seed] - Keypair seed
   *      for Hyperswarm identity.
   *    @param {Object} [opts.logOpts] - Options to configure Logger.
   *    @param {boolean} [opts.logOpts.logToConsole] - Whether to output logs to
   *      console.
   *    @param {boolean} [opts.logOpts.logToFile] - Whether to write logs to a
   *      file.
   *    @param {string} [opts.logOpts.logFilePath] - Filesystem path for the
   *      log file (if logToFile=true).
   *    @param {string} [opts.logOpts.level=LOG_LEVELS.INFO] - Log level.
   *    @param {Object} [opts.indexOpts] - Options for the index manager.
   *    @param {boolean} [opts.indexOpts.disableWatching=false] - Whether to
   *      disable native filesystem watching, so index has to be managed
   *      manually. (Only advised for testing purposes).
   *    @param {number} [opts.indexOpts.pollInterval=500] - Interval in
   *      milliseconds for polling the local file index.
   *    @param {boolean} [opts.indexOpts.relay] - Whether to automaically
   *      download files from the network.
   *    @param {string} [opts.networkKey] - Optional network key to join a
   *      specific network on startup. If not provided, a new random key will be
   *      generated.
   *    @param {Array<string>} [opts.unfinishedDownloads] - Optional unfinished
   *      downloads to resume on startup. These include inProgress downloads
   *      and queuedDownloads.
   */
  constructor({
    corestorePath,
    watchPath,
    indexName = "local-file-index",
    swarmOpts = {},
    logOpts = {
      logToConsole: true,
    },
    indexOpts = {},
    networkKey,
    unfinishedDownloads = [],
  }) {
    super();

    // Set save data
    this._networkKey = networkKey
      ? utils.formatToBuffer(networkKey)
      : utils.generateSeed();
    this._corestorePath = corestorePath;
    this._watchPath = utils.normalizePath(watchPath);
    this._indexName = indexName;
    const normalizedSeed = swarmOpts.seed
      ? utils.formatToBuffer(swarmOpts.seed)
      : utils.generateSeed();
    this._swarmOpts = {
      ...swarmOpts,
      seed: normalizedSeed,
    };
    this._logOpts = logOpts;
    const {
      disablePolling = false,
      pollInterval = 500,
      relay = false,
    } = indexOpts;
    this._indexOpts = {
      disablePolling,
      pollInterval,
      relay,
    };

    // Set up logging
    this.#log = new Logger(this._logOpts);
    this.#log.info("Initializing PearDrive...");
    this.#log.debug("DEBUG mode enabled");

    // Set up corestore and swarm
    this._swarm = new Hyperswarm(this._swarmOpts);
    this._store = new Corestore(corestorePath);
    this._rpcConnections = new Map();
    this._uploads = new Map();
    this._downloads = new Map();
    this._inProgress = {};

    // Save data
    this._corestorePath = corestorePath;
    this._watchPath = watchPath;
    this._indexName = indexName;

    // Set up IndexManager for PearDrive network file system management
    this.#im = new IndexManager({
      store: this._store,
      log: this.#log,
      watchPath: watchPath,
      indexOpts: this._indexOpts,
      uploads: this._uploads,
      downloads: this._downloads,
      sendFileRequest: async (peerId, filePath) => {
        return await this._sendFileRequest(peerId, filePath);
      },
      sendFileRelease: async (peerId, filePath) => {
        return await this._sendFileRelease(peerId, filePath);
      },
      unfinishedDownloads,
    });

    // Set up network connection hook
    this._swarm.on("connection", this._onConnection.bind(this));
  }

  //////////////////////////////////////////////////////////////////////////////
  // Getters
  //////////////////////////////////////////////////////////////////////////////

  /** Whether or not 'relay' mode is enabled */
  get relay() {
    return this._indexOpts.relay;
  }

  /** Get the absolute path to the local file storage for this PearDrive */
  get watchPath() {
    return this._watchPath;
  }

  /** Read-only public key for RPC connections to the network */
  get publicKey() {
    return utils.formatToStr(this._publicKey);
  }

  /** Read-only stringified network key */
  get networkKey() {
    return utils.formatToStr(this._networkKey);
  }

  /**
   * Read-only inProgressDownloads dictionary
   *
   * @returns {Object} - In-progress downloads meta-data
   */
  get inProgressDownloads() {
    return { ...this.#im.inProgressDownloads };
  }

  /** Read-only 'seed' - Stringified basis for this peer's keypair */
  get seed() {
    return utils.formatToStr(this._swarmOpts.seed);
  }

  /** Read-only Corestore path (path to all the internal networking storage) */
  get corestorePath() {
    return this._corestorePath;
  }

  /**
   * Read-only logging options
   *
   * @returns {Object} - Logger options
   */
  get logOpts() {
    return { ...this._logOpts };
  }

  /** Read-only index options */
  get indexOpts() {
    return { ...this._indexOpts };
  }

  /**
   * Read-only public key Buffer for RPC connections to the network
   *
   * @returns {ArrayBuffer} - Public key as ArrayBuffer
   *
   * @private
   */
  get _publicKey() {
    return this._swarm.keyPair.publicKey;
  }

  /**
   * Returns JSON object for all data needed to re-instantiate PearDrive
   *
   * @returns {Object} - Save data
   */
  get saveData() {
    return this.#buildSaveData();
  }

  //////////////////////////////////////////////////////////////////////////////
  // Public functions
  //////////////////////////////////////////////////////////////////////////////

  /**
   * Listen for a custom message and handle it
   *
   * @param {string} name - Name of the custom message
   * @param {Function} cb - Callback function to handle the message
   */
  listen(name, cb) {
    this.#log.info(`Listening for custom message: ${name}`);
    this._customMessageHooks[name] = cb;
  }

  /**
   * Remove a listener for a custom message
   *
   * @param {string} name - Name of the custom message
   */
  unlisten(name) {
    this.#log.info(`Removing listener for custom message: ${name}`);
    delete this._customMessageHooks[name];
  }

  /**
   * Listen for a one-time custom message and handle it
   *
   * @param {string} name - Name of the custom message
   * @param {Function} cb - Callback function to handle the message
   */
  listenOnce(name, cb) {
    this.#log.info(`Listening once for custom message: ${name}`);
    this._onceCustomMessageHooks[name] = cb;
  }

  /**
   * Remove a one-time 'once' listener for a custom message
   *
   * @param {string} name - Name of the custom message
   */
  unlistenOnce(name) {
    this.#log.info(`Removing one-time listener for custom message: ${name}`);
    delete this._onceCustomMessageHooks[name];
  }

  /** Activate 'relay' mode */
  activateRelay() {
    this.#log.info("Activating 'relay' mode...");
    this._indexOpts.relay = true;
    this.#emitSaveDataUpdate();
  }

  /** Deactivate 'relay' mode */
  deactivateRelay() {
    this.#log.info("Deactivating 'relay' mode...");
    this._indexOpts.relay = false;
    this.#emitSaveDataUpdate();
  }

  /**
   * Join or create a network.
   *
   * @param {string|Uint8Array|ArrayBuffer} [networkKey] - Optional network
   *  topic key.
   *
   * @returns {Promise<void>}
   */
  async joinNetwork(networkKey) {
    // Set network key if provided, otherwise create a new one
    if (networkKey) {
      this._networkKey = utils.formatToBuffer(networkKey);
    }

    this.#log.info(
      "Joining network with key",
      utils.formatToStr(this.networkKey)
    );
    const discovery = this._swarm.join(this._networkKey, {
      server: true,
      client: true,
    });
    await discovery.flushed();
    this.connected = true;
    this.#emitSaveDataUpdate();
  }

  /**
   * Download a file from a remote peer over RPC.
   *
   * @param {string | Uint8Array | ArrayBuffer} peerId - Hex string identifier
   *  of the peer
   * @param {string} filePath - Path of the file on the remote peer
   *
   * @returns {Promise<void>}
   * @throws {Error} If download fails
   */
  async downloadFileFromPeer(peerId, filePath) {
    this.#log.info(`Downloading file "${filePath}" from peer ${peerId}...`);

    try {
      // Ask the peer for a Hyperblobs reference for this file
      const blobRef = await this._sendFileRequest(peerId, filePath);

      // Validate hyperblob ref type
      const valid =
        blobRef &&
        typeof blobRef === "object" &&
        blobRef.type === "hyperblobs" &&
        typeof blobRef.key === "string" &&
        blobRef.id &&
        typeof blobRef.id === "object";
      if (!valid) {
        throw new Error(
          `Invalid FILE_REQUEST response \
          (expected {type:'hyperblobs', key:string, id:object})`
        );
      }

      // Handle download
      await this.#im.handleDownload(peerId, filePath, blobRef);

      // Cleanup
      await this._sendFileRelease(peerId, filePath);
    } catch (err) {
      this.#log.error(`Error downloading file from peer ${peerId}`, err);
      throw err;
    }
  }

  /**
   * Send a message to a given peer. Whatever the type you set for the message,
   * it must have a callback hook on the receiving peer using the listen() or
   * listenOnce() methods. If the peer has a callback set that returns
   * something, this function will return that value.
   *
   * @param {Uint8Array | ArrayBuffer | string} peerId - Hex-encoded public key
   *  of the peer
   * @param {string} type - Type of the message, this can be any string except
   *  the reserved RPC types.
   * @param {any} payload - Data to send to the peer
   *
   * @returns {Promise<any>} - Response from the peer
   *
   * @throws {Error} If no RPC connection is found for the peer
   */
  async sendMessage(peerId, type, payload) {
    // Get RPC connection for the peer
    const rpc = this._rpcConnections.get(utils.formatToStr(peerId));
    if (!rpc) {
      const err = new Error(`No RPC connection found for peer ${peerId}`);
      this.#log.error(err);
      this.emit(C.EVENT.ERROR, err);
      throw err;
    }

    try {
      this.#log.info(`Sending "${type}" to ${peerId} with payload`, payload);
      const response = await rpc.request(
        C.RPC.MESSAGE,
        JSON.stringify({
          type,
          payload,
        })
      );
      this.#log.info(
        `Received response for "${type}" from ${peerId}:`,
        response
      );
      return response;
    } catch (err) {
      this.#log.error(`RPC request "${type}" to ${peerId} failed`, err);
      (this._hooks[C.EVENT.ERROR] || []).forEach((cb) => cb(err));
      throw err;
    }
  }

  /**
   * List all connected peers with their public key and remote index key.
   *
   * @returns {Array<{publicKey: string, hyperbeeKey: string|null}>}
   */
  listPeers() {
    return this.#listPeers().map((peer) => ({
      publicKey: utils.formatToStr(peer.publicKey),
      hyperbeeKey: peer.hyperbeeKey
        ? utils.formatToStr(peer.hyperbeeKey)
        : null,
    }));
  }

  /** List files available locally */
  async listLocalFiles() {
    const rawLocalFiles = await this.#im.getLocalIndexInfo();
    const localFiles = rawLocalFiles.files;
    return localFiles;
  }

  /** List files currently available over the network */
  async listNetworkFiles() {
    const rawNetworkFiles = await this.#im.getNetworkIndexInfo();

    const networkFiles = new Map();
    for (const [key, value] of rawNetworkFiles.entries()) {
      networkFiles.set(key, value.files);
    }

    return networkFiles;
  }

  /** List files currently available over the network not downloaded locally */
  async listNonLocalFiles() {
    const rawFiles = await this.#im.getNonlocalNetworkIndexInfo();

    const nonlocalFiles = new Map();
    for (const [key, value] of rawFiles.entries()) {
      nonlocalFiles.set(key, value.files);
    }
    return nonlocalFiles;
  }

  //////////////////////////////////////////////////////////////////////////////
  // Private functions
  //////////////////////////////////////////////////////////////////////////////

  /**
   * List all connected peers with their public key and remote index key. This
   * funtion returns the raw buffer keys, if you want the stringified keys,
   * use listPeersStringified() instead.
   *
   * @returns {Array<{publicKey: ArrayBuffer, hyperbeeKey: ArrayBuffer|null}>}
   */
  #listPeers() {
    const peers = [];
    for (const [peerId, _rpc] of this._rpcConnections.entries()) {
      const bee = this.#im.remoteIndexes.get(peerId);
      const hyperbeeKey = bee ? bee.core.key : null;
      peers.push({ publicKey: peerId, hyperbeeKey });
    }
    return peers;
  }

  /**
   * Poll the local file index once (only use for testing purposes, when
   * disablePolling is true).
   *
   * @returns {Promise<void>}
   *
   * @private
   */
  async _syncLocalFilesOnce() {
    if (!this._indexOpts.disablePolling) {
      this.#log.warn(
        "Can't manually sync local files, automatic syncing is enabled."
      );
    }

    this.#log.info("Syncing local files...");
    try {
      await this.#im.localIndex.pollOnce();
    } catch {
      this.#log.warn("Could not sync local files, autopolling may be enabled.");
    }
  }

  /**
   * Send FILE_REQUEST to peer
   *
   * @param {string |Uint8Array | ArrayBuffer} peerId - Peer ID to send request
   *  to
   * @param {string} filePath - Path of the file to request on remote peer
   *
   * @returns {Promise<Object>} - Peer download blob reference
   *
   * @private
   */
  async _sendFileRequest(peerId, filePath) {
    try {
      const peerIdStr = utils.formatToStr(peerId);
      this.#log.info(
        `Sending FILE_REQUEST to peer ${peerIdStr} for file ${filePath}`
      );

      const response = await this._sendInternalMessageToPeer(
        peerIdStr,
        C.RPC.FILE_REQUEST,
        filePath
      );
      if (response.status !== C.MESSAGE_STATUS.SUCCESS)
        throw new Error(`File request failed on peer ${peerIdStr}`);
      const peerDownloadInfo = response.data;

      return peerDownloadInfo;
    } catch (err) {
      this.#log.error(`Error sending file request to peer ${peerId}`, err);
      throw err;
    }
  }

  /**
   * Send FILE_RELEASE to peer
   *
   * @param {string | Uint8Array | ArrayBuffer} peerId - Peer ID to send request
   *
   * @param {string} filePath - Path of the file to release on remote peer
   *
   * @return {Promise<boolean>} - True if the release was successful
   *
   * @private
   */
  async _sendFileRelease(peerId, filePath) {
    try {
      const peerIdStr = utils.formatToStr(peerId);
      this.#log.info(
        `Sending FILE_RELEASE to peer ${peerIdStr} for file ${filePath}`
      );
      const response = await this._sendInternalMessageToPeer(
        peerIdStr,
        C.RPC.FILE_RELEASE,
        filePath
      );
      if (response.status !== C.MESSAGE_STATUS.SUCCESS) {
        throw new Error("File release failed on peer");
      }

      return true;
    } catch (err) {
      this.#log.error(`Error sending file release to peer ${peerId}`, err);
      throw err;
    }
  }

  /**
   * Wrap a Hyperswarm connection in an RPC instance.
   *
   * @param {Connection} connetworkKeyn - Hyperswarm connection
   *
   * @returns {RPC}
   *
   * @private
   */
  _createRPC(conn) {
    this.#log.info(
      `Creating RPC for connection from ${utils.formatToStr(
        conn.remotePublicKey
      )}`
    );

    // Init RPC / teardown
    const rpc = new RPC(conn, { valueEncoding: c.json });
    rpc.on("close", () => this._onDisconnect(conn));

    /** Ensure all responses to RPC responses are JSON encodable */
    const safeResponse = async (response) => {
      try {
        const rawOutput = await response();

        // Never send undefined
        let output = rawOutput === undefined ? null : rawOutput;

        this.#log.info("Response data:", output);
        return output;
      } catch (error) {
        // Let RPC send RPC request error
        throw error;
      }
    };

    // Wire up RPC methods
    rpc.respond(C.RPC.LOCAL_INDEX_KEY_REQUEST, async () => {
      this.#log.info(
        `Handling LOCAL_INDEX_KEY_REQUEST from ${utils.formatToStr(
          conn.remotePublicKey
        )}`
      );
      return safeResponse(() => this._onLocalIndexKeyRequest(conn));
    });
    rpc.respond(C.RPC.FILE_REQUEST, async (payload) => {
      this.#log.info(
        `Handling FILE_REQUEST from ${utils.formatToStr(conn.remotePublicKey)}`
      );
      return safeResponse(() => this._onFileRequest(conn, payload));
    });
    rpc.respond(C.RPC.FILE_RELEASE, async (payload) => {
      this.#log.info(
        `Handling FILE_RELEASE from ${utils.formatToStr(conn.remotePublicKey)}`
      );
      return safeResponse(() => this._onFileRelease(conn, payload));
    });
    rpc.respond(C.RPC.MESSAGE, async (payload) => {
      this.#log.info(
        `Handling MESSAGE from ${utils.formatToStr(conn.remotePublicKey)}`
      );
      return safeResponse(() => this._onMessage(conn, payload));
    });

    return rpc;
  }

  /**
   * Handle RPC.LOCAL_INDEX_KEY_REQUEST
   *
   * @param {Connection} conn – Hyperswarm connection
   * @param {any} _payload – Ignored
   *
   * @returns {Promise<string>} – Hex-encoded local file-index key
   *
   * @private
   */
  async _onLocalIndexKeyRequest(conn) {
    const peerId = utils.formatToStr(conn.remotePublicKey);
    this.#log.info("Handling LOCAL_INDEX_KEY_REQUEST from", peerId);

    try {
      // Get key
      const keyBuf = this.#im.localIndex.bee.key;
      const keyHex = utils.formatToStr(keyBuf);

      // Send key back to peer
      this.#log.info(`Sending local index key to ${peerId}: ${keyHex}`);
      return {
        status: C.MESSAGE_STATUS.SUCCESS,
        data: keyHex,
      };
    } catch (err) {
      this.#log.error(`Error in LOCAL_INDEX_KEY_REQUEST for ${peerId}`, err);
      this.emit(C.EVENT.ERROR, err);
      return {
        status: C.MESSAGE_STATUS.ERROR,
        data: `Error retrieving local index key: ${err.message}`,
      };
    }
  }

  /**
   * Handle a new peer connection: replicate cores and notify managers.
   *
   * @param {Connection} conn - Hyperswarm connection
   *
   * @private
   */
  async _onConnection(conn) {
    this._store.replicate(conn);

    // Create RPC instance for this connection
    const rpc = this._createRPC(conn);
    const peerId = utils.formatToStr(conn.remotePublicKey);
    this._rpcConnections.set(peerId, rpc);
    this.#log.info(`New peer connected: ${peerId}`);

    // Request local index key from peer
    this.#log.info(`Requesting local index key from peer ${peerId}...`);
    let peerKeyHex;
    try {
      this.#log.info(`Requesting LOCAL_INDEX_KEY from ${peerId}…`);

      const response = await this._sendInternalMessageToPeer(
        peerId,
        C.RPC.LOCAL_INDEX_KEY_REQUEST,
        null
      );
      if (response.status !== C.MESSAGE_STATUS.SUCCESS)
        throw new Error(`Failed to retrieve local index key from ${peerId}`);
      peerKeyHex = response.data;

      this.#log.info(`Received LOCAL_INDEX_KEY from ${peerId}:`, peerKeyHex);
    } catch (err) {
      this.#log.error(`Error requesting local index key from ${peerId}`, err);
      this.emit(C.EVENT.ERROR, err);
      return;
    }

    // Register the hyperbee and add to index manager
    try {
      const keyBuf = utils.formatToBuffer(peerKeyHex);
      const core = this._store.get({ key: keyBuf });
      const bee = new Hyperbee(core, {
        keyEncoding: "utf-8",
        valueEncoding: "json",
      });
      await bee.ready();

      await this.#im.addBee(peerId, bee);
      this.#log.info(`Registered remote index for ${peerId}`);
    } catch (err) {
      this.#log.error(`Error registering remote index for ${peerId}`, err);
      return;
    }

    // Emit peer update event
    this.emit(C.EVENT.PEER_CONNECTED, peerId);
    this.#log.info(`Peer ${peerId} connected and ready!`);
  }

  /**
   * Handle a peer disconnection: clean up RPC and notify managers.
   *
   * @param {Connection} conn - Hyperswarm connection
   *
   * @private
   */
  _onDisconnect(conn) {
    const peerId = utils.formatToStr(conn.remotePublicKey);
    this.#log.info(`Peer ${peerId} disconnected.`);

    // Graceful teardown
    this._rpcConnections.delete(peerId);
    this.#im.handlePeerDisconnected(peerId);

    // Emit peer update event
    this.emit(C.EVENT.PEER_DISCONNECTED, peerId);
  }

  /**
   * Handler for file download requests from peers.
   *
   * @private
   */
  async _onFileRequest(conn, payload) {
    this.#log.info(
      `Handling FILE_REQUEST from ${utils.formatToStr(conn.remotePublicKey)}`
    );

    try {
      // Validate file path
      if (!payload || typeof payload !== "string") {
        throw new Error("Invalid file path in FILE_REQUEST");
      }

      this.#im.markTransfer(payload, "upload", conn.remotePublicKey);
      const uploadBlobRef = await this.#im.createUploadBlob(payload);
      if (!uploadBlobRef) {
        const peer = utils.formatToStr(conn.remotePublicKey);
        throw new Error(
          `Failed to create upload blob for file ${payload} on peer ${peer}`
        );
      }

      return {
        status: C.MESSAGE_STATUS.SUCCESS,
        data: uploadBlobRef,
      };
    } catch (err) {
      this.#log.error(
        `Error handling file request from ${utils.formatToStr(
          conn.remotePublicKey
        )}`,
        err
      );
      this.emit(C.EVENT.ERROR, err);
      return {
        status: C.MESSAGE_STATUS.ERROR,
        data: `Error handling file request: ${err.message}`,
      };
    }
  }

  /**
   * Handler for file release requests from peers.
   *
   * @private
   */
  async _onFileRelease(conn, payload) {
    this.#log.info(
      `Handling FILE_RELEASE from ${utils.formatToStr(conn.remotePublicKey)}`
    );

    try {
      // Validate file path
      if (!payload || typeof payload !== "string") {
        throw new Error("Invalid file path in FILE_RELEASE");
      }

      const peerId = utils.formatToStr(conn.remotePublicKey);
      await this.#im.unmarkTransfer(payload, "upload", peerId);

      return {
        status: C.MESSAGE_STATUS.SUCCESS,
        data: "File release successful",
      };
    } catch (err) {
      this.#log.error(
        `Error handling file release from ${utils.formatToStr(
          conn.remotePublicKey
        )}`,
        err
      );
      this.emit(C.EVENT.ERROR, err);
      return {
        status: C.MESSAGE_STATUS.ERROR,
        data: `Error handling file release: ${err.message}`,
      };
    }
  }

  /**
   * Handler for messages from peers
   *
   * @param {RPC.Connection} conn - RPC connection
   * @param {string} rawPayload - Raw JSON string payload
   *
   * @private
   */
  async _onMessage(conn, rawPayload) {
    try {
      const { type, payload } = JSON.parse(rawPayload);
      this.#log.info(
        `Received MESSAGE of type "${type}" from ${conn.remotePublicKey}`
      );
      this.#log.debug("MESSAGE Payload:", payload);

      // Check for one-time 'once' listener first
      if (this._onceCustomMessageHooks[type]) {
        const cb = this._onceCustomMessageHooks[type];
        delete this._onceCustomMessageHooks[type];

        // Run the callback and escape any errors
        let response;
        try {
          response = await cb(payload);
        } catch (err) {
          this.#log.error(
            `Error handling one-time MESSAGE of type "${type}" from \
            ${conn.remotePublicKey}`,
            err
          );
          this.emit(C.EVENT.ERROR, err);
          return {
            status: C.MESSAGE_STATUS.ERROR,
            data: `Error handling one-time message of type "${type}"`,
          };
        }

        // Response must have been successful, return
        return {
          status: C.MESSAGE_STATUS.SUCCESS,
          data: response,
        };
      }

      // Retrieve callback function associated with this message type
      const cb = this._customMessageHooks[type];
      if (!cb) {
        const errorMessage = `No handler for message type "${type}" \
        from ${conn.remotePublicKey} (did you forget to call listen()?)`;
        this.#log.error(errorMessage);
        this.emit(C.EVENT.ERROR, errorMessage);
        return {
          status: C.MESSAGE_STATUS.UNKNOWN_MESSAGE_TYPE,
          data: `No handler for type "${type}"`,
        };
      }

      // Run the callback and escape any errors
      let response;
      try {
        response = await cb(payload);
      } catch (err) {
        this.#log.error(
          `Error handling MESSAGE of type "${type}" from \
          ${conn.remotePublicKey}`,
          err
        );
        this.emit(C.EVENT.ERROR, err);
        return {
          status: C.MESSAGE_STATUS.ERROR,
          data: `Error handling message of type "${type}"`,
        };
      }

      // Response must have been successful, return
      return {
        status: C.MESSAGE_STATUS.SUCCESS,
        data: response,
      };
    } catch (err) {
      this.#log.error(
        `Error handling MESSAGE from ${conn.remotePublicKey}`,
        err
      );
      this.emit(C.EVENT.ERROR, err);
    }
  }

  /**
   * Send an RPC message to a connected peer.
   *
   * @param {string} peerId – Hex-encoded public key of the peer
   * @param {string} type – RPC method name (e.g. C.RPC.LOCAL_INDEX_KEY_SEND)
   * @param {string|Uint8Array} payload – Data to send
   *
   * @returns {Promise<{status: string, data: any}>} – Whatever the RPC method
   * returns
   *
   * @throws {Error} If no RPC connection is found for the peer or if payload is
   * undefined
   *
   * @private
   */
  async _sendInternalMessageToPeer(peerId, type, payload) {
    this.#log.debug(
      "Sending internal message",
      type,
      payload,
      "to peer",
      peerId
    );

    // Validate RPC (Receiving peer)
    const rpc = this._rpcConnections.get(peerId);
    if (!rpc) {
      const err = new Error(`No RPC connection found for peer ${peerId}`);
      this.#log.error(err);
      this.emit(C.EVENT.ERROR, err);
      throw err;
    }

    // Validate payload (Cannot send undefined)
    if (typeof payload === "undefined") {
      const err = new Error(`Cannot send undefined payload to peer ${peerId}`);
      this.#log.error(err);
      this.emit(C.EVENT.ERROR, err);
      throw err;
    }

    try {
      this.#log.info(`Sending "${type}" to ${peerId} with payload`, payload);
      const response = await rpc.request(type, payload);
      this.#log.info(
        `Received response for "${type}" from ${peerId}:`,
        response
      );
      return response;
    } catch (err) {
      this.#log.error(`RPC request "${type}" to ${peerId} failed`, err);
      (this._hooks[C.EVENT.ERROR] || []).forEach((cb) => cb(err));
      throw err;
    }
  }

  /** Build save data */
  #buildSaveData() {
    return {
      corestorePath: this.corestorePath,
      watchPath: this.watchPath,
      indexName: this._indexName,
      swarmOpts: {
        seed: this.seed,
      },
      logOpts: this.logOpts,
      networkKey: this.networkKey,
      relay: this.relay,
      indexOpts: this.indexOpts,
      queuedDownloads: this.#buildUnfinishedDownloads(),
    };
  }

  /**
   * Build unfinished downloads list
   *
   * @returns {Array} - List of paths of unfinished downloads
   */
  #buildUnfinishedDownloads() {
    const unfinished = [];

    // Add in-progress downloads
    for (const [filePath, info] of Object.entries(this.inProgressDownloads)) {
      if (info.type === "download") {
        unfinished.push(filePath);
      }
    }

    // Add queued downloads, ensure no timing issues cause duplicates
    const queuedDownloads = this.#im.queuedDownloads.keys();
    for (const filePath of queuedDownloads) {
      if (!unfinished.includes(filePath)) {
        unfinished.push(filePath);
      }
    }

    return unfinished;
  }

  /**
   * Handle an update to relevant save data
   */
  #emitSaveDataUpdate() {
    this.#log.debug("Emitting save data update...");

    // Noop if not opened
    if (!this.opened) return;

    // Emit event
    this.emit(C.EVENT.SAVE_DATA_UPDATE, this.saveData);
  }

  //////////////////////////////////////////////////////////////////////////////
  // Lifecycle methods
  //////////////////////////////////////////////////////////////////////////////

  /**
   * Used for init from ReadyResource superclass
   *
   * @protected
   */
  async _open() {
    this.#log.info("Opening PearDrive...");

    // Ready resources
    await this._store.ready();
    await this.#im.ready();

    // Wire up IM event listeners
    this.#im.on(C.IM_EVENT.SAVE_DATA_UPDATE, () => {
      this.#emitSaveDataUpdate();
    });
    this.#im.on(C.IM_EVENT.LOCAL_FILE_ADDED, (data) => {
      this.emit(C.EVENT.LOCAL_FILE_ADDED, data);
      this.#emitSaveDataUpdate();
    });
    this.#im.on(C.IM_EVENT.LOCAL_FILE_REMOVED, (data) => {
      this.emit(C.EVENT.LOCAL_FILE_REMOVED, data);
    });
    this.#im.on(C.IM_EVENT.LOCAL_FILE_CHANGED, (data) => {
      this.emit(C.EVENT.LOCAL_FILE_CHANGED, data);
    });
    this.#im.on(C.IM_EVENT.PEER_FILE_ADDED, (data) => {
      this.emit(C.EVENT.PEER_FILE_ADDED, data);
    });
    this.#im.on(C.IM_EVENT.PEER_FILE_REMOVED, (data) => {
      this.emit(C.EVENT.PEER_FILE_REMOVED, data);
    });
    this.#im.on(C.IM_EVENT.PEER_FILE_CHANGED, (data) => {
      this.emit(C.EVENT.PEER_FILE_CHANGED, data);
    });
    this.#im.on(C.IM_EVENT.IN_PROGRESS_DOWNLOAD_STARTED, (data) => {
      this.#emitSaveDataUpdate();
      this.emit(C.EVENT.IN_PROGRESS_DOWNLOAD_STARTED, data);
    });
    this.#im.on(C.IM_EVENT.IN_PROGRESS_DOWNLOAD_FAILED, (data) => {
      this.#emitSaveDataUpdate();
      this.emit(C.EVENT.IN_PROGRESS_DOWNLOAD_FAILED, data);
    });
    this.#im.on(C.IM_EVENT.IN_PROGRESS_DOWNLOAD_COMPLETED, (data) => {
      this.#emitSaveDataUpdate();
      this.emit(C.EVENT.IN_PROGRESS_DOWNLOAD_COMPLETED, data);
    });
    this.#im.on(C.IM_EVENT.DOWNLOAD_PROGRESS, (data) => {
      this.emit(C.EVENT.DOWNLOAD_PROGRESS, data);
    });

    this.#log.info("PearDrive opened successfully!");
  }

  /**
   * Used for teardown from ReadyResource superclass
   *
   * @protected
   */
  async _close() {
    this.#log.info("Closing PearDrive...");

    await this.#im.close();
    this._swarm.destroy();
    await this._store.close();

    this.#log.info("PearDrive closed successfully!");
  }
}
