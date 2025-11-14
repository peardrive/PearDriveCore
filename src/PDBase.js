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
 * @remarks Handles the shared knowledge of a PearDrive network, basically an
 * interface built on top of Autobase.
 *
 * @protected
 */

import ReadyResource from "ready-resource";
import Autobase from "autobase";
import c from "compact-encoding";

export class PDBase extends ReadyResource {
  /** @private {Logger} Logger */
  #log;
  /** @private {Corestore} Corestore namespace */
  #store;
  /** @private {Autobase} Autobase instance */
  #base;

  /**
   * @param {Object} opts Options
   * @param {Logger} opts.log Logger instance
   * @param {Corestore} opts.store Corestore namespace
   */
  constructor({ log, store }) {
    super();

    this.#log = log;
    this.#store = store;

    // There won't be a writer key if this is the first time initializing, so
    // generate one if the arg is missing.
    this.#base = new Autobase(this.#store, null, {
      valueEncoding: c.json,
      open: () => {},
      apply: () => {},
    });
  }

  //////////////////////////////////////////////////////////////////////////////
  // Getters
  //////////////////////////////////////////////////////////////////////////////

  /** Get this peer's nickname */
  get nickname() {
    return "TODO";
  }

  /** Get the network's name */
  get networkName() {
    return "TODO";
  }

  /** Get the raw Autobase view */
  get view() {
    return this.#base.view;
  }

  //////////////////////////////////////////////////////////////////////////////
  // Public methods
  //////////////////////////////////////////////////////////////////////////////

  setNickname() {}

  setNetworkName() {}

  //////////////////////////////////////////////////////////////////////////////
  // Lifecycle methods
  //////////////////////////////////////////////////////////////////////////////

  async _open() {
    this.#log.info("Opening PDBase...");

    this.#log.info("PDBase opened.");
  }

  async _close() {
    this.#log.info("Closing PDBase...");

    this.#log.info("PDBase closed.");
  }
}
