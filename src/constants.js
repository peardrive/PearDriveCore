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
 * @remarks
 *  Core constants used throughout SisterJS:
 *   - `EVENTS` (hook event names)
 *   - `RPC` (RPC method identifiers)
 *   - any other shared values (default options, codes, etc.)
 *  You can imports these constants from SisterJS root
 *
 * @example
 *  import {EVENT, RPC_EVENT} from "@hopets/sisterjs";
 */

/** Message types for RPC */
export const RPC = {
  REMOTE_DOWNLOAD_COMMAND: "remote_download_command",
  PEER_UPDATE: "peer_update",
  NETWORK_NICKNAME_SEND: "network_nickname_send",
  NETWORK_NICKNAME_REQUEST: "network_nickname_request",
  MESSAGE: "custom_message",

  LOCAL_INDEX_KEY_SEND: "local_index_key_send",
  LOCAL_INDEX_KEY_REQUEST: "local_index_key_request",

  FILE_REQUEST: "file_request",
  FILE_SEND: "file_send",
  FILE_RELEASE: "file_release",
};

/**
 * Update event types triggered by changes received by hypercores or filesystem
 */
export const EVENT = {
  /** Any and all built-in event updates */
  SYSTEM: "system_update",
  /** Update from peer connection */
  PEER: "peer_event",
  /** Update from a file over the network */
  NETWORK: "network_update",
  /** Update on a file on the local filesystem */
  LOCAL: "local_update",
  /** Any error thrown in Sister */
  ERROR: "error_update",
};
