/*!
 * Copyright (C) 2025 PearDrive LLC
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

  LOCAL_INDEX_KEY_REQUEST: "local_index_key_request",
  PDBASE_BOOTSTRAP_REQUEST: "pdbase_bootstrap_request",

  FILE_REQUEST: "file_request",
  FILE_RELEASE: "file_release",
};

/**
 * Update event types triggered by changes received by hypercores or filesystem
 */
export const EVENT = {
  /** Download progress info */
  DOWNLOAD_PROGRESS: "[PD]: download_progress",

  /** Save data update */
  SAVE_DATA_UPDATE: "[PD]: save_data_update",

  /** Any error thrown in PearDrive */
  ERROR: "[PD]: error",

  /** Peer connected */
  PEER_CONNECTED: "[PD]: peer_connected",
  /** Peer disconnected */
  PEER_DISCONNECTED: "[PD]: peer_disconnected",

  /** Local file added  */
  LOCAL_FILE_ADDED: "[PD]: local_file_added",
  /** Local file removed  */
  LOCAL_FILE_REMOVED: "[PD]: local_file_removed",
  /** Local file changed  */
  LOCAL_FILE_CHANGED: "[PD]: local_file_changed",

  /** Peer file added  */
  PEER_FILE_ADDED: "[PD]: peer_file_added",
  /** Peer file removed  */
  PEER_FILE_REMOVED: "[PD]: peer_file_removed",
  /** Peer file changed  */
  PEER_FILE_CHANGED: "[PD]: peer_file_changed",

  /** New download started  */
  DOWNLOAD_STARTED: "[PD]: in_progress_download_started",
  /** Download failed */
  DOWNLOAD_FAILED: "[PD]: in_progress_download_failed",
  /** Download completed  */
  DOWNLOAD_COMPLETED: "[PD]: in_progress_download_completed",
};

/**
 * Message status codes for RPC communications
 */
export const MESSAGE_STATUS = {
  ERROR: "error",
  SUCCESS: "success",
  UNKNOWN_MESSAGE_TYPE: "unknown_message_type",
};
