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
 *  Core constants used throughout PearDrive:
 *   - `EVENTS` (hook event names)
 *   - `RPC` (RPC method identifiers)
 *   - any other shared values (default options, codes, etc.)
 *  You can imports these constants from PearDrive root
 *
 * @example
 *  import {EVENT, RPC_EVENT} from "@peardrive/core";
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
  SYSTEM: "[PD]: system_update",
  /** Update from peer connection */
  PEER: "[PD]: peer_event",
  /** Update from a file over the network */
  NETWORK: "[PD]: network_update",
  /** Update on a file on the local filesystem */
  LOCAL: "[PD]: local_update",
  /** Any error thrown in PearDrive */
  ERROR: "[PD]: error_update",
  /** Download progress info */
  DOWNLOAD_PROGRESS: "[PD]: download_progress",

  /** Local file added (Wrapper for IM event) */
  LOCAL_FILE_ADDED: "[PD]: local_file_added",
  /** Local file removed (Wrapper for IM event) */
  LOCAL_FILE_REMOVED: "[PD]: local_file_removed",
  /** Local file changed (Wrapper for IM event) */
  LOCAL_FILE_CHANGED: "[PD]: local_file_changed",
};

/**
 * Events emitted from LocalFileIndex
 *
 * @protected
 */
export const LFI_EVENT = {
  /** Emitted when a file is added to the local file index
   *
   * Emitted with the following data:
   * - `path`: The (relative) path of the file
   * - `hash`: The hash of the file
   */
  FILE_ADDED: "[LFI]: local_file_index_file_added",
  /** Emitted when a file is removed from the local file index */
  FILE_REMOVED: "[LFI]: local_file_index_file_removed",
  /**
   * Emitted when a file's contents have changed
   *
   * Emitted with the following data:
   * - `path`: The (relative) path of the file
   * - `prevHash`: The previous hash of the file
   * - `hash`: The new hash of the file
   */
  FILE_CHANGED: "[LFI]: local_file_index_file_changed",
};

/**
 * Events emitted from IndexManager
 *
 * @protected
 */
export const IM_EVENT = {
  /** Mirrors emitted from LFI FILE_ADDED */
  LOCAL_FILE_ADDED: "[IM]: local_file_added",
  /** Mirrors emitted from LFI FILE_REMOVED */
  LOCAL_FILE_REMOVED: "[IM]: local_file_removed",
  /** Mirrors emitted from LFI FILE_CHANGED */
  LOCAL_FILE_CHANGED: "[IM]: local_file_changed",
};
