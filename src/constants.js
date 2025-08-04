/** Message types for RPC */
export const RPC = {
  REMOTE_DOWNLOAD_COMMAND: "remote_download_command",
  PEER_UPDATE: "peer_update",
  NETWORK_NICKNAME_SEND: "network_nickname_send",
  NETWORK_NICKNAME_REQUEST: "network_nickname_request",
  CUSTOM: "custom_message",

  LOCAL_INDEX_KEY_SEND: "local_index_key_send",
  LOCAL_INDEX_KEY_REQUEST: "local_index_key_request",

  FILE_REQUEST: "file_request",
  FILE_SEND: "file_send",
};

/**
 * Update event types triggered by changes received by hypercores or filesystem
 */
export const EVENT = {
  /** Any and all event updates */
  GENERAL: "general",
  /** Update from peer connection */
  PEER: "peer_event",
  /** Update from a file over the network */
  NETWORK: "network_update",
  /** Update on a file on the local filesystem */
  LOCAL: "local_update",
  /** Any error thrown in Sister */
  ERROR: "error_update",
};
