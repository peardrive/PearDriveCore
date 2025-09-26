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

  LOCAL_INDEX_KEY_REQUEST: "local_index_key_request",

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

  /** Local file added (Wrapper for IM event) */
  LOCAL_FILE_ADDED: "[PD]: local_file_added",
  /** Local file removed (Wrapper for IM event) */
  LOCAL_FILE_REMOVED: "[PD]: local_file_removed",
  /** Local file changed (Wrapper for IM event) */
  LOCAL_FILE_CHANGED: "[PD]: local_file_changed",

  /** Peer file added (Wrapper for IM event) */
  PEER_FILE_ADDED: "[PD]: peer_file_added",
  /** Peer file removed (Wrapper for IM event) */
  PEER_FILE_REMOVED: "[PD]: peer_file_removed",
  /** Peer file changed (Wrapper for IM event) */
  PEER_FILE_CHANGED: "[PD]: peer_file_changed",

  /** New inProgress download added (Wrapper for IM event) */
  IN_PROGRESS_DOWNLOAD_STARTED: "[PD]: in_progress_download_started",
  /** An inProgress download has failed (Wrapper for IM event) */
  IN_PROGRESS_DOWNLOAD_FAILED: "[PD]: in_progress_download_failed",
  /** inProgress download removed (Wrapper for IM event) */
  IN_PROGRESS_DOWNLOAD_COMPLETED: "[PD]: in_progress_download_completed",
};

/**
 * Events emitted from LocalFileIndex
 *
 * @protected
 */
export const LFI_EVENT = {
  /** Any error occurring in the local file index */
  ERROR: "[LFI]: local_file_index_error",
  /**
   * Emitted when a file is added to the local file index
   *
   * Emitted with the following data:
   * - `path`: The (relative) path of the file
   * - `hash`: The hash of the file
   */
  FILE_ADDED: "[LFI]: local_file_index_file_added",
  /**
   * Emitted when a file is removed from the local file index
   *
   * Emits the path string
   */
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
  /*** Any time something causes save data to update */
  SAVE_DATA_UPDATE: "[IM]: save_data_update",

  /** Mirrors emitted from LFI FILE_ADDED */
  LOCAL_FILE_ADDED: "[IM]: local_file_added",
  /** Mirrors emitted from LFI FILE_REMOVED */
  LOCAL_FILE_REMOVED: "[IM]: local_file_removed",
  /** Mirrors emitted from LFI FILE_CHANGED */
  LOCAL_FILE_CHANGED: "[IM]: local_file_changed",

  /** When a peer has added a file */
  PEER_FILE_ADDED: "[IM]: peer_file_added",
  /** When a peer has removed a file */
  PEER_FILE_REMOVED: "[IM]: peer_file_removed",
  /** When a peer's file has changed */
  PEER_FILE_CHANGED: "[IM]: peer_file_changed",

  /** New inProgress download added */
  IN_PROGRESS_DOWNLOAD_STARTED: "[IM]: in_progress_download_started",
  /** An inProgress download has failed */
  IN_PROGRESS_DOWNLOAD_FAILED: "[IM]: in_progress_download_failed",
  /** inProgress download removed */
  IN_PROGRESS_DOWNLOAD_COMPLETED: "[IM]: in_progress_download_completed",
};

/**
 * Message status codes for RPC communications
 */
export const MESSAGE_STATUS = {
  ERROR: "error",
  SUCCESS: "success",
  UNKNOWN_MESSAGE_TYPE: "unknown_message_type",
};
