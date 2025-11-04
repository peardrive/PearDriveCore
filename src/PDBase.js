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

export class PDBase extends ReadyResource {
  /** @private {Logger} Logger */
  #log;
  /** @private {Corestore} Corestore namespace */
  #store;

  constructor({ log, store }) {
    super();

    this.#log = log;
    this.#store = store;
  }

  //////////////////////////////////////////////////////////////////////////////
  // Public methods
  //////////////////////////////////////////////////////////////////////////////

  setNickname() {}

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
