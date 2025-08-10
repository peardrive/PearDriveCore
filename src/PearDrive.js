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
export default class PearDrive {
  /** @private {Hyperswarm} Hyperswarm object for peer discovery */
  _swarm;
  /** @private {Corestore} Corestore for all hypercores */
  _store;
  /** @private {Map<string, RPC>} RPC PearDrive connections */
  _rpcConnections;
  /** @private {Logger} Logger */
  #log;
  /** @private {IndexManager} Index manager for watching network/local files */
  _indexManager;
  /** @private {string} Absolute path to corestore */
  _corestorePath;
  /** @private {string} Path to PearDrive's local file storage */
  _watchPath;
  /** @private {string} Name of the local indexer */
  _indexName;
  /** @private List of event callbacks*/
  _hooks;
  /** @private Stored indexer options */
  _indexOpts;
  /** @private Stored hyperswarm options */
  _swarmOpts;
  /** @private Logger options */
  _logOpts;
  /** @private {Map} Writable hyperdrives (for downloading files) */
  _downloadDrives;
  /** @private {Map} Readable hyperdrives (for uploading files) */
  _uploadDrives;
  /** @private {Object} In-progress downloads meta-data */
  _inProgress;
  /** @private {string} Seed for Hyperswarm */
  _seed;

  /**
   * @param {Object} opts
   * @param {string}  opts.corestorePath - Filesystem path for corestore data
   * @param {string}  opts.watchPath - Path to watch for local files
   * @param {string}  [opts.indexName] - Name of the local file index core
   * @param {Object}  [opts.swarmOpts]   - Options passed to Hyperswarm
   * @param {Array<string|Buffer|Uint8Array>} [opts.swarmOpts.bootstrap] - DHT
   *  bootstrap list for peer discovery.
   * @param {Uint8Array|Buffer|string} [opts.swarmOpts.seed] - Keypair seed for
   *  Hyperswarm identity.
   * @param {Object} [opts.logOpts] - Options to configure Logger.
   * @param {boolean} [opts.logOpts.logToConsole] - Whether to output logs to
   *  console.
   * @param {boolean} [opts.logOpts.logToFile] - Whether to write logs to a
   *  file.
   * @param {string}  [opts.logOpts.logFilePath] - Filesystem path for the log
   *  file (if logToFile=true).
   * @param {Object} [opts.indexOpts] - Options for the index manager.
   * @param {boolean} [opts.indexOpts.poll=true] - Whether to poll for changes
   *  in the local file index automatically.
   * @param {number} [opts.indexOpts.pollInterval=500] - Interval in
   *  milliseconds for polling the local file index.
   * @param {string} [opts.networkKey] - Optional network key to join
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
  }) {
    this._emitEvent = this._emitEvent.bind(this);
    this._hooks = {};

    // Set save data
    this._networkKey = networkKey
      ? utils.formatToBuffer(networkKey)
      : utils.generateSeed();
    this._corestorePath = corestorePath;
    this._watchPath = watchPath;
    this._indexName = indexName;
    this._swarmOpts = swarmOpts;
    this._swarmOpts.seed = swarmOpts.seed
      ? utils.formatToBuffer(swarmOpts.seed)
      : utils.generateSeed();
    this._logOpts = logOpts;
    const { poll = true, pollInterval = 500 } = indexOpts;
    this._indexOpts = {
      poll,
      pollInterval,
    };

    // Set up logging
    this.#log = new Logger(this._logOpts);
    this.#log.info("Initializing PearDrive...");

    // Set up corestore and swarm
    this._swarm = new Hyperswarm(swarmOpts);
    this._store = new Corestore(corestorePath);
    this._rpcConnections = new Map();
    this._uploadDrives = new Map();
    this._downloadDrives = new Map();
    this._inProgress = {};

    // Save data
    this._corestorePath = corestorePath;
    this._watchPath = watchPath;
    this._indexName = indexName;

    this._indexManager = new IndexManager({
      store: this._store,
      log: this.#log,
      watchPath: watchPath,
      emitEvent: this._emitEvent,
      indexOpts: this._indexOpts,
      uploadDrives: this._uploadDrives,
      downloadDrives: this._downloadDrives,
      inProgress: this._inProgress,
    });

    this._swarm.on("connection", this._onConnection.bind(this));
  }

  //////////////////////////////////////////////////////////////////////////////
  // Getters
  //////////////////////////////////////////////////////////////////////////////

  /** Get the absolute path to the local file storage for this PearDrive */
  get watchPath() {
    return this._watchPath;
  }

  /**
   * Read-only public key for RPC connections to the network
   *
   * @returns {ArrayBuffer} - Public key as ArrayBuffer
   */
  get publicKey() {
    return this._swarm.keyPair.publicKey;
  }

  /**
   * Read-only public key for RPC connections to the network
   *
   * @returns {string} - Public key as hex string
   */
  get publicKeyStr() {
    return utils.formatToStr(this.publicKey);
  }

  /**
   * Read-only stringified network key
   *
   * @returns {string} - Network key as hex string
   */
  get networkKey() {
    return utils.formatToStr(this._networkKey);
  }

  /**
   * Read-only inProgressDownloads dictionary
   *
   * @returns {Object} - In-progress downloads meta-data
   */
  get inProgressDownloads() {
    return { ...this._inProgress };
  }

  /**
   * Read-only 'seed' - Stringified basis for this peer's keypair
   *
   * @returns {string} - Seed as hex string
   */
  get seed() {
    return utils.formatToStr(this._swarmOpts.seed);
  }

  /**
   * Read-only Corestore path (path to all the internal networking storage)
   *
   * @returns {string} - Corestore path
   */
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

  //////////////////////////////////////////////////////////////////////////////
  // Public functions
  //////////////////////////////////////////////////////////////////////////////

  /**
   * Initialize corestore and index manager.
   *
   * @returns {Promise<void>}
   */
  async ready() {
    await this._store.ready();
    await this._indexManager.ready();
  }

  /**
   * Get save data as JSON.
   *
   * @returns {Object} Save data object
   */
  getSaveData() {
    return {
      corestorePath: this.corestorePath,
      watchPath: this.watchPath,
      indexName: this._indexName,
      swarmOpts: {
        seed: this.seed,
      },
      logOpts: this.logOpts,
      networkKey: this.networkKey,
    };
  }

  /**
   * Wire up hooks for events here.
   */
  on(event, cb) {
    this.#log.info(`Registering hook for event: ${event}`);
    if (this._hooks[event]) {
      this.#log.warn(`Overwriting existing hook for event: ${event}`);
    }
    this._hooks[event] = cb;
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
  }

  /**
   * Download a file from a remote peer over RPC.
   *
   * @param {string | Uint8Array | ArrayBuffer} peerId - Hex string identifier
   *  of the peer
   * @param {string} filePath - Path of the file on the remote peer
   */
  async downloadFileFromPeer(peerId, filePath) {
    this.#log.info(`Downloading file "${filePath}" from peer ${peerId}...`);

    try {
      // Create a hyperdrive on peer, get the key
      const peerDownloadKey = await this._sendFileRequest(peerId, filePath);
      if (typeof peerDownloadKey !== "string") {
        throw new Error(
          `Invalid peer download key type: ${typeof peerDownloadKey}`
        );
      }

      // Handle download
      this._indexManager.markTransfer(filePath, "download", peerId);
      await this._indexManager.createDownloadDrive(filePath, peerDownloadKey);
      await this._indexManager.executeDownload(filePath);

      // Cleanup
      await this._indexManager.unmarkTransfer(filePath, "download", peerId);
      await this._sendFileRelease(peerId, filePath);
    } catch (err) {
      this.#log.error(`Error downloading file from peer ${peerId}`, err);
      throw err;
    }
  }

  /**
   * Send a message to a given peer. Whatever the type you set for the message,
   * it must have a callback hook on the receiving peer using the on() method.
   * If the peer has a callback set that returns something, this function
   * will return that value.
   *
   * @param {Uint8Array | ArrayBuffer | string} peerId - Hex-encoded public key
   *  of the peer
   *
   * @param {string} type - Type of the message, this can be any string except
   *  the reserved RPC types.
   *
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
      this._emitEvent(C.EVENT.ERROR, err);
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
   * List all connected peers with their public key and remote index key. This
   * funtion returns the raw buffer keys, if you want the stringified keys,
   * use listPeersStringified() instead.
   *
   * @returns {Array<{publicKey: ArrayBuffer, hyperbeeKey: ArrayBuffer|null}>}
   */
  listPeers() {
    const peers = [];
    // TODO fix this
    for (const [peerId, _rpc] of this._rpcConnections.entries()) {
      const bee = this._indexManager.remoteIndexes.get(peerId);
      const hyperbeeKey = bee ? bee.core.key : null;
      peers.push({ publicKey: peerId, hyperbeeKey });
    }
    return peers;
  }

  /**
   * List all connected peers with their public key and remote index key. This
   * function returns the stringified keys, if you want the raw buffer keys,
   * use listPeers() instead.
   *
   * @returns {Array<{publicKey: string, hyperbeeKey: string|null}>}
   */
  listPeersStringified() {
    return this.listPeers().map((peer) => ({
      publicKey: utils.formatToStr(peer.publicKey),
      hyperbeeKey: peer.hyperbeeKey
        ? utils.formatToStr(peer.hyperbeeKey)
        : null,
    }));
  }

  /** Close PearDrive gracefully */
  async close() {
    this.#log.info("Closing PearDrive...");
    this._indexManager.close();
    this._swarm.destroy();
    await this._store.close();
    this.#log.info("PearDrive closed.");
  }

  /** Activate automatic polling for the local file index */
  activateLocalFileSyncing() {
    this.#log.info("Activating automatic polling for local files...");
    this._indexManager.startPolling();
    this._syncConfig();
  }

  /** Deactivate automatic polling for the local file index */
  deactivateLocalFileSyncing() {
    this.#log.info("Deactivating automatic polling for local files...");
    this._indexManager.stopPolling();
    this._syncConfig();
  }

  /**
   * Poll the local file index once
   *
   * @returns {Promise<void>}
   */
  async syncLocalFilesOnce() {
    if (this._indexOpts.poll) {
      this.#log.warn(
        "Can't manually sync local files, automatic syncing is enabled."
      );
    }

    this.#log.info("Syncing local files...");
    try {
      await this._indexManager.localIndex.pollOnce();
    } catch {
      this.#log.warn("Could not sync local files, autopolling may be enabled.");
    }
  }

  /** List files available locally */
  async listLocalFiles() {
    return await this._indexManager.getLocalIndexInfo();
  }

  /** List files currently available over the network */
  async listNetworkFiles() {
    return await this._indexManager.getNetworkIndexInfo();
  }

  /** List files currently available over the network not downloaded locally */
  async listNonLocalFiles() {
    return await this._indexManager.getNonlocalNetworkIndexInfo();
  }

  //////////////////////////////////////////////////////////////////////////////
  // Private functions
  //////////////////////////////////////////////////////////////////////////////

  /**
   * Send FILE_REQUEST to peer
   *
   * @param {string |Uint8Array | ArrayBuffer} peerId - Peer ID to send request
   *  to
   * @param {string} filePath - Path of the file to request on remote peer
   *
   * @returns {Promise<string>} - Peer download drive key
   *
   * @private
   */
  async _sendFileRequest(peerId, filePath) {
    try {
      const peerIdStr = utils.formatToStr(peerId);
      this.#log.info(
        `Sending FILE_REQUEST to peer ${peerIdStr} for file ${filePath}`
      );
      const peerDownloadInfoRaw = await this._sendInternalMessageToPeer(
        peerIdStr,
        C.RPC.FILE_REQUEST,
        filePath
      );
      const peerDownloadInfoBuf = Buffer.from(peerDownloadInfoRaw, "hex");
      const peerDownloadInfo = utils.formatToStr(peerDownloadInfoBuf);
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
      if (response !== true) {
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
    const rpc = new RPC(conn, { valueEncoding: c.json });
    rpc.on("close", () => this._onDisconnect(conn));

    // Wire up RPC methods
    rpc.respond(C.RPC.LOCAL_INDEX_KEY_SEND, async (payload) => {
      this.#log.info(
        `Handling LOCAL_INDEX_KEY_SEND from ${utils.formatToStr(
          conn.remotePublicKey
        )}`
      );
      return this._onLocalIndexKeySend(conn, payload);
    });
    rpc.respond(C.RPC.LOCAL_INDEX_KEY_REQUEST, async () => {
      this.#log.info(
        `Handling LOCAL_INDEX_KEY_REQUEST from ${utils.formatToStr(
          conn.remotePublicKey
        )}`
      );
      return this._onLocalIndexKeyRequest(conn);
    });
    rpc.respond(C.RPC.FILE_REQUEST, async (payload) => {
      this.#log.info(
        `Handling FILE_REQUEST from ${utils.formatToStr(conn.remotePublicKey)}`
      );
      return this._onFileRequest(conn, payload);
    });
    rpc.respond(C.RPC.FILE_RELEASE, async (payload) => {
      this.#log.info(
        `Handling FILE_RELEASE from ${utils.formatToStr(conn.remotePublicKey)}`
      );
      return this._onFileRelease(conn, payload);
    });
    rpc.respond(C.RPC.MESSAGE, async (payload) => {
      this.#log.info(
        `Handling MESSAGE from ${utils.formatToStr(conn.remotePublicKey)}`
      );
      // Custom request handling can be added here
      return this._onMessage(conn, payload);
    });

    return rpc;
  }

  /**
   * Handle RPC.LOCAL_INDEX_KEY_SEND
   *
   * @returns {Promise<void>}
   *
   * @private
   */
  async _onLocalIndexKeySend(conn, payload) {
    this.#log.info("Handling LOCAL_INDEX_KEY_SEND…");
    const peerId = utils.formatToStr(conn.remotePublicKey);

    try {
      // Get (and replicate) the core from corestore
      const keyBuf = utils.formatToBuffer(payload);
      const core = this._store.get({ key: keyBuf });

      // Create and index the hyperbee instance
      const bee = new Hyperbee(core, {
        keyEncoding: "utf-8",
        valueEncoding: "json",
      });
      await bee.ready();
      await this._indexManager.addBee(peerId, bee);
      this.#log.info(`Registered remote index for peer ${peerId}`);

      return true;
    } catch (err) {
      this.#log.error(`Error registering remote index for peer ${peerId}`, err);
      throw err;
    }
  }

  /**
   * Handle RPC.LOCAL_INDEX_KEY_REQUEST
   *
   * @param {Connection} conn – Hyperswarm connection
   * @param {any} _payload – Ignored
   *
   * @returns {Promise<string>}    – Hex-encoded local file-index key
   *
   * @private
   */
  async _onLocalIndexKeyRequest(conn) {
    const peerId = utils.formatToStr(conn.remotePublicKey);
    this.#log.info("Handling LOCAL_INDEX_KEY_REQUEST from", peerId);

    try {
      // Get key
      const keyBuf = this._indexManager.localIndex.getKey();
      const keyHex = utils.formatToStr(keyBuf);

      // Send key back to peer
      this.#log.info(`Sending local index key to ${peerId}: ${keyHex}`);
      return keyHex;
    } catch (err) {
      this.#log.error(`Error in LOCAL_INDEX_KEY_REQUEST for ${peerId}`, err);
      // emit ERROR hooks
      (this._hooks[C.EVENT.ERROR] || []).forEach((cb) => cb(err));
      throw err;
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
      peerKeyHex = await this._sendInternalMessageToPeer(
        peerId,
        C.RPC.LOCAL_INDEX_KEY_REQUEST,
        null
      );
      this.#log.info(`Received LOCAL_INDEX_KEY from ${peerId}:`, peerKeyHex);
    } catch (err) {
      this.#log.error(`Error requesting local index key from ${peerId}`, err);
      this._emitEvent(C.EVENT.ERROR, err);
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

      await this._indexManager.addBee(peerId, bee);
      this.#log.info(`Registered remote index for ${peerId}`);
    } catch (err) {
      this.#log.error(`Error registering remote index for ${peerId}`, err);
      return;
    }

    // Emit peer update event
    this._emitEvent(C.EVENT.PEER, peerId);
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
    this._indexManager.handlePeerDisconnected(peerId);

    // Emit peer update event
    this._emitEvent(C.EVENT.PEER, peerId);
  }

  /**
   * Emit events to registered hooks.
   *
   * @param {string} event - Event name
   *
   * @param {any} payload - Arguments to pass to the event handlers
   *
   * @private
   */
  _emitEvent(eventName, payload) {
    this.#log.info(`Emitting event: ${eventName}`, payload);
    if (!this._hooks[eventName]) return;

    /**
     * Prevent infinite loop by running errors thrown inside callbacks in
     * child function
     */
    const emitError = (error) => {
      const cb = this._hooks[C.EVENT.ERROR];
      if (!cb) return;
      try {
        cb(error);
      } catch (err) {
        this.#log.error("Error in ERROR hook for", eventName, err);
      }
    };

    /**
     * Run system events once when they are specifically called, and also
     * run them when any other event is emitted.
     */
    const systemEvent = () => {
      const cb = this._hooks[C.EVENT.SYSTEM];
      if (!cb) return;
      try {
        cb(payload);
      } catch (err) {
        this.#log.error("Error in SYSTEM hook for", eventName, err);
        emitError(err);
        return;
      }
    };

    // Only run system and error callbacks once
    if (eventName === C.EVENT.SYSTEM) {
      systemEvent();
      return;
    }
    if (eventName === C.EVENT.ERROR) {
      emitError(payload);
      return;
    }

    systemEvent();

    // Run user-defined hooks
    const cb = this._hooks[eventName];
    if (!cb) return;
    try {
      cb(payload);
    } catch (err) {
      this.#log.error("Error in hook for", eventName, err);
      emitError(err);
    }
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

      this._indexManager.markTransfer(payload, "upload", conn.remotePublicKey);
      const response = await this._indexManager.createUploadDrive(payload);

      return response;
    } catch (err) {
      this.#log.error(
        `Error handling file request from ${utils.formatToStr(
          conn.remotePublicKey
        )}`,
        err
      );
      this._emitEvent(C.EVENT.ERROR, err);
      return;
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
      await this._indexManager.unmarkTransfer(payload, "upload", peerId);

      return true;
    } catch (err) {
      this.#log.error(
        `Error handling file release from ${utils.formatToStr(
          conn.remotePublicKey
        )}`,
        err
      );
      this._emitEvent(C.EVENT.ERROR, err);
      return false;
    }
  }

  /**
   * Handler for messages from sisters
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

      const cb = this._hooks[type];
      if (!cb) {
        this.#log.warn(
          `No handler for message type "${type}" from ${conn.remotePublicKey}`
        );
        return { status: "error", message: `No handler for type "${type}"` };
      }

      const response = await cb(payload);
      return response;
    } catch (err) {
      this.#log.error(
        `Error handling MESSAGE from ${conn.remotePublicKey}`,
        err
      );
      this._emitEvent(C.EVENT.ERROR, err);
    }
  }

  /**
   * Send an RPC message to a connected sister.
   *
   * @param {string} peerId – Hex-encoded public key of the peer
   * @param {string} type – RPC method name (e.g. C.RPC.LOCAL_INDEX_KEY_SEND)
   * @param {string|Uint8Array} payload – Data to send
   *
   * @returns {Promise<any>} – Whatever the RPC method returns
   *
   * @private
   */
  async _sendInternalMessageToPeer(peerId, type, payload) {
    const rpc = this._rpcConnections.get(peerId);
    if (!rpc) {
      const err = new Error(`No RPC connection found for peer ${peerId}`);
      this.#log.error(err);
      this._emitEvent(C.EVENT.ERROR, err);
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
}
