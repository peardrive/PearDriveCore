/*!
 * Copyright (C) 2025 PearDrive
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

/**
 * @remarks Handles the shared knowledge of a PearDrive network, basically an
 * interface built on top of Autobase.
 *
 * @protected
 */

import ReadyResource from "ready-resource";
import Autobase from "autobase";
import Hyperbee from "hyperbee";
import Logger from "@hopets/logger";
import c from "compact-encoding";

import * as C from "./constants.js";
import * as utils from "./utils/index.js";

export class PDBase extends ReadyResource {
  /** @private {Logger} Logger */
  #log;
  /** @private {Corestore} Corestore namespace */
  #store;
  /** @private {Autobase | null} Autobase instance */
  #base;
  /** @private {boolean} Whether this instance is an indexer */
  #isIndexer;
  /** @private {string | null} Bootstrap key */
  #bootstrap;
  /** @private {Uint8Array | ArrayBuffer} Writer key buffer */
  #writerKey;
  /** @private {Hypercore} Writer core */
  #writerCore;
  /** @private {string | null} The current network nickname */
  #networkName;
  /** @private {string | null} The current peer's nickname */
  #nickname;
  /** @private {Map} Map of all peer's current nicknames */
  #nicknames;
  /** @private {boolean} PDBase connected flag */
  #connected;

  /**
   * @param {Object} opts Options
   * @param {Logger} opts.log Logger instance
   * @param {Corestore} opts.store Corestore namespace
   * @param {Uint8Array | ArrayBuffer | string} [opts.writer] Writer key
   * @param {boolean} [opts.indexer=true] Whether or not to connect as an
   * indexer (defaults to true).
   * @param {string} [opts.bootstrap] Autobase bootstrap key
   */
  constructor({ log, store, writer = null, bootstrap = null, indexer = true }) {
    super();

    this.#log = log;
    this.#store = store;
    this.#isIndexer = indexer;
    this.#writerKey = writer
      ? utils.formatToBuffer(writer)
      : utils.generateKey();
    this.#writerCore = this.#store.get(this.#writerKey);
    this.#bootstrap = bootstrap;

    this.#connected = false;
    this.#networkName = null;
    this.#nickname = null;
    this.#nicknames = new Map();

    this.#base = null;
  }

  //////////////////////////////////////////////////////////////////////////////
  // Getters
  //////////////////////////////////////////////////////////////////////////////

  /** @readonly Get this peer's nickname */
  get nickname() {
    return this.#nickname;
  }

  /** @readonly Get the network's name */
  get networkName() {
    return this.#networkName;
  }

  /** @readonly Get nicknames map */
  get nicknames() {
    return this.#nicknames;
  }

  /** @readonly Get relevant information as JSON object for save data */
  get saveData() {
    return {
      indexer: this.#isIndexer,
      writerKey: utils.bufferToStr(this.#writerKey),
    };
  }

  /** @readonly Get stringified writer key */
  get writerKey() {
    return utils.bufferToStr(this.#writerKey);
  }

  /** @readonly Get connected flag */
  get connected() {
    return this.#connected;
  }

  /** @readonly Autobase bootstrap key hex */
  get bootstrap() {
    return this.#bootstrap;
  }

  /** Get the raw Autobase view */
  get _view() {
    return this.#base.view;
  }

  /** Get the nicknames Hyperbee core */
  get _nicknameCore() {
    return this.#base.view.nicknames;
  }

  /** Get the networkName Hypercore */
  get _networkNameCore() {
    return this.#base.view.networkName;
  }

  //////////////////////////////////////////////////////////////////////////////
  // Public methods
  //////////////////////////////////////////////////////////////////////////////

  /**
   * Connect PDBase as root node to PearDrive network
   *
   * @returns {Promise<void>}
   */
  async connectAsRoot() {
    // Noop if already connected
    if (this.#connected) {
      this.#log.warn("PDBase is already connected.");
      return;
    }

    // Since this will be the root node, the writer core will become the
    // bootstrap node
    this.#bootstrap = utils.bufferToStr(this.#writerKey);

    try {
      this.#createAutobase();
    } catch (error) {
      this.#log.error("Error connecting PDBase as root:", error);
      throw error;
    }
  }

  /**
   * Connect PDBase to PearDrive network
   *
   * @param {string | Uint8Array | ArrayBuffer} [bootstrap] - Autobase bootstrap
   *   key
   *
   * @returns {Promise<void>}
   */
  async connect(bootstrap) {
    // Noop if already connected
    if (this.#connected) {
      this.#log.warn("PDBase is already connected.");
      return;
    }

    try {
      // Set bootstrap key if provided
      if (bootstrap) {
        this.#bootstrap = utils.formatToStr(bootstrap);
      }

      // Ensure a bootstrap key exists
      if (!this.#bootstrap) {
        this.#log.error("No bootstrap key provided for PDBase connection.");
        throw new Error("No bootstrap key provided for PDBase connection.");
      }

      this.#createAutobase();
    } catch (error) {
      this.#log.error("Error connecting PDBase:", error);
      throw error;
    }
  }

  /**
   * Set a new nickname for this peer
   *
   * @param {string} newName - New peer nickname
   */
  setNickname(newName) {
    // TODO
  }

  /**
   * Set a new name for the network
   *
   * @param {string} newName - New network nickname
   */
  setNetworkName(newName) {
    // TODO
  }

  /**
   * Add an input autobase key to autobase
   *
   * @param {string | Uint8Array | ArrayBuffer} peerKey - Peer public key
   * @param {string | Uint8Array | ArrayBuffer} inputKey - Peer's writer key
   */
  addInput(peerKey, inputKey) {
    const peerKeyBuf = utils.formatToBuffer(peerKey);
    const peerKeyStr = utils.formatToStr(peerKey);
    // TODO
  }

  //////////////////////////////////////////////////////////////////////////////
  // Private methods
  //////////////////////////////////////////////////////////////////////////////

  /**
   * Create the Autobase instance
   *
   * @throws {Error} If no bootstrap key is set, or any other error occurs
   * creating the Autobase
   */
  #createAutobase() {
    // If no bootstrap key exists, this shouldn't be called.
    if (!this.#bootstrap) {
      this.#log.error("No bootstrap key provided for Autobase connection.");
      throw new Error("No bootstrap key provided for Autobase connection.");
    }

    this.#base = new Autobase(this.#store, null, {
      valueEncoding: c.json,

      open(store) {
        return {
          nicknames: new Hyperbee(store.get("nicknames"), {
            valueEncoding: c.json,
          }),
          networkName: store.get("networkName", {
            valueEncoding: c.json,
          }),
        };
      },

      async apply(nodes, view, host) {
        for (const { value } of nodes) {
          if (!value) continue;
          this.#log.debug("PDBase applying autobase entry:", value);

          // Handle addWriter
          if (typeof value.addWriter === "string") {
            this.#log.debug("Adding new writer to Autobase:", value.addWriter);
            const writerKey = Buffer.from(value.addWriter, "hex");
            const peerPublicKey = Buffer.from(value.peerKey, "hex");
            await host.addWriter(writerKey, { indexer: false });
            continue;
          }

          switch (value.stream) {
            case "nicknames":
              this.#log.debug(
                "Updating peer nickname:",
                value.peerKey,
                value.nickname
              );
              // TODO, every peer nickname update updates it's own entry in the
              // nicknames Hyperbee

              // Emit change event
              this.emit(C.EVENT.NICKNAME_CHANGED);
              break;

            case "networkName":
              this.#log.debug("Updating network name:", value.networkName);
              // TODO update network name

              // Emit change event
              this.emit(C.EVENT.NETWORK_NAME_CHANGED);
              break;

            default:
              break;
          }
          //await view.append(value);
        }
      },
    });
  }

  /**
   * Get peer key from writer key
   *
   * @param {Uint8Array | ArrayBuffer | string} writerKey - Writer key
   * @returns {string | null} Peer public key
   */
  #getPeerKeyFromWriter(writerKey) {
    const writerKeyStr = utils.formatToStr(writerKey);
    // TODO
    return null;
  }

  //////////////////////////////////////////////////////////////////////////////
  // Lifecycle methods
  //////////////////////////////////////////////////////////////////////////////

  async _open() {
    this.#log.info("Opening PDBase...");

    // Ready hypercores
    await this.#writerCore.ready();

    this.#log.info("PDBase opened.");
  }

  async _close() {
    this.#log.info("Closing PDBase...");

    this.#log.info("PDBase closed.");
  }
}
