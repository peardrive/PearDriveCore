import Hyperswarm from "hyperswarm";
import Corestore from "corestore";
import RPC from "protomux-rpc";
import c from "compact-encoding";
import Logger from "./Logger.js";
import * as C from "./constants.js";
import * as utils from "./utils/index.js";
import Hyperbee from "hyperbee";

import { IndexManager } from "./IndexManager.js";
import { TransferManager } from "./TransferManager.js";

/*******************************************************************************
 * Sister.js
 * ---
 * P2P networking system for node.js applications.
 ******************************************************************************/
export default class Sister {
  /** @private {Hyperswarm} Hyperswarm object for peer discovery */
  _swarm;
  /** @private {Corestore} Corestore for all hypercores */
  _store;
  /** @private {Map<string, RPC>} RPC Sister connections */
  _rpcConnections;
  /** @private {Logger} Logger */
  #log;
  /** @private {IndexManager} Index manager for watching network/local files */
  _indexManager;
  /** @private {TransferManager} Transfer manager for handling file downloads */
  _transferManager;
  /** @private {string} Absolute path to corestore */
  _corestorePath;
  /** @private {string} Path to Sister's local file storage */
  _watchPath;
  /** @private {string} Name of the local indexer */
  _indexName;
  /** @private List of event callbacks*/
  _hooks;

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
   */
  constructor({
    corestorePath,
    watchPath,
    indexName = "local-file-index",
    swarmOpts = {},
    logOpts = {},
    indexOpts = {},
  }) {
    this._emitEvent = this._emitEvent.bind(this);
    this._hooks = {};

    // Set save data
    this._corestorePath = corestorePath;
    this._watchPath = watchPath;
    this._indexName = indexName;
    this._swarmOpts = swarmOpts;
    this._logOpts = logOpts;
    const { poll = true, pollInterval = 500 } = indexOpts;
    this._indexOpts = {
      poll,
      pollInterval,
    };

    // Set up logging
    this.#log = new Logger(logOpts);
    this.#log.info("Initializing Sister...");

    // Set up corestore and swarm
    this._swarm = new Hyperswarm(swarmOpts);
    this._store = new Corestore(corestorePath);
    this._rpcConnections = new Map();

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
    });
    this._transferManager = new TransferManager({
      log: this.#log,
      store: this._store,
      emitEvent: this._emitEvent,
    });

    this._swarm.on("connection", this._onConnection.bind(this));
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
      corestorePath: this._corestorePath,
      watchPath: this._watchPath,
      indexName: this._indexName,
      swarmOpts: this._swarmOpts,
      logOpts: this._logOpts,
    };
  }

  /**
   * Wire up hooks for events here.
   */
  on(event, callback) {
    if (!this._hooks[event]) {
      this._hooks[event] = [];
    }
    this._hooks[event].push(callback);
  }

  /**
   * Join or create a sisterhood.
   *
   * @param {string|Uint8Array|ArrayBuffer} [networkKey] - Optional network
   *  topic key.
   *
   * @returns {Promise<void>}
   */
  async joinNetwork(networkKey) {
    // Set network key if provided, otherwise create a new one
    if (networkKey) {
      this.networkKey = utils.formatToBuffer(networkKey);
    } else {
      this.networkKey = utils.generateSeed();
    }

    this.#log.info(
      "Joining network with key",
      utils.formatToStr(this.networkKey)
    );
    const discovery = this._swarm.join(this.networkKey, {
      server: true,
      client: true,
    });
    await discovery.flushed();
    this.connected = true;
  }

  /**
   * List all connected peers with their public key and remote index key.
   *
   * @returns {Array<{publicKey: string, hyperbeeKey: string|null}>}
   */
  listPeers() {
    const peers = [];
    for (const [peerId, rpc] of this._rpcConnections.entries()) {
      const bee = this._indexManager.remoteIndexes.get(peerId);
      const hyperbeeKey = bee ? bee.core.key.toString("hex") : null;
      peers.push({ publicKey: peerId, hyperbeeKey });
    }
    return peers;
  }

  /** Close Sister gracefully */
  async close() {
    this.#log.info("Closing Sister...");
    this._indexManager.close();
    this._swarm.destroy();
    await this._store.close();
    this.#log.info("Sister closed.");
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

  //////////////////////////////////////////////////////////////////////////////
  // Private functions
  //////////////////////////////////////////////////////////////////////////////

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
      peerKeyHex = await this._sendMessageToPeer(
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
    this._transferManager.handlePeerConnected(peerId, rpc);

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

    // Graceful teardown
    this._rpcConnections.delete(peerId);
    this._indexManager.handlePeerDisconnected(peerId);
    this._transferManager.handlePeerDisconnected(peerId);

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
      this._hooks[C.EVENT.ERROR]?.forEach((cb) => {
        try {
          cb(error);
        } catch (err) {
          this.#log.error("Error in ERROR hook for", eventName, err);
        }
      });
    };

    /**
     * Run system events once when they are specifically called, and also
     * run them when any other event is emitted.
     */
    const systemEvent = () => {
      try {
        this._hooks[C.EVENT.SYSTEM]?.forEach((cb) => {
          try {
            cb(payload);
          } catch (err) {
            this.#log.error("Error in SYSTEM hook for", eventName, err);
            emitError(err);
          }
        });
      } catch (err) {
        this.#log.error("Error in SYSTEM hook for", eventName, err);
        emitError(err);
        return;
      }
    };

    // Only run system events once
    if (eventName === C.EVENT.SYSTEM) {
      systemEvent();
      return;
    }

    // Only run error events once
    if (eventName === C.EVENT.ERROR) {
      emitError(payload);
    }

    systemEvent();

    // Run user-defined hooks
    this._hooks[eventName]?.forEach((cb) => {
      try {
        cb(payload);
      } catch (err) {
        this.#log.error("Error in hook for", eventName, err);
        emitError(err);
      }
    });
  }

  /**
   * Send an RPC message to a connected peer.
   *
   * @param {string} peerId – Hex-encoded public key of the peer
   * @param {string} type – RPC method name (e.g. C.RPC.LOCAL_INDEX_KEY_SEND)
   * @param {string|Uint8Array} payload – Data to send
   *
   * @returns {Promise<any>} – Whatever the RPC method returns
   *
   * @private
   */
  async _sendMessageToPeer(peerId, type, payload) {
    const rpc = this._rpcConnections.get(peerId);
    if (!rpc) {
      const err = new Error(`No RPC connection found for peer ${peerId}`);
      this.#log.error(err);
      (this._hooks[C.EVENT.ERROR] || []).forEach((cb) => cb(err));
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
