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
 * @remarks Manages the indexing of all files locally and on the network.
 */

import Hyperbee from "hyperbee";
import * as C from "./constants.js";
import LocalFileIndex from "./LocalFileIndex.js";

/*******************************************************************************
 * IndexManager
 * ---
 * Manages the peer-to-peer synchronization of file-index Hyperbees.
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
   */
  constructor({ store, log, watchPath, emitEvent, indexOpts }) {
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
    });
    this.remoteIndexes = new Map();
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
   * you fire a NETWORK update back to Sister.
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
   * @param {string} peerId - Hex string identifier of the peer
   */
  handlePeerDisconnected(peerId) {
    this.remoteIndexes.delete(peerId);
    this.#log.info(`🗑️ Remote index removed for peer ${peerId}`);
  }

  /**
   * Get save data as JSON
   */
  getSaveData() {
    return {
      localFileIndexName: this.localIndex.name,
      watchPath: this.localIndex.watchPath,
      poll: this.localIndex.poll,
      pollInterval: this.localIndex.pollInterval,
    };
  }

  /** Close IndexManager gracefully */
  async close() {
    this.#log.info("Closing IndexManager...");
    await this.localIndex.close();
    this.#log.info("IndexManager closed.");
  }
}
