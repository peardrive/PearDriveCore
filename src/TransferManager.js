import fs from "fs";
import * as C from "./constants.js";

/*******************************************************************************
 * TransferManager
 * ---
 * Handles on-demand file streaming over RPC.
 ******************************************************************************/
export class TransferManager {
  /** @private {Logger} */
  logger;

  /**
   * @param {Object} opts
   * @param {Logger} opts.logger - Logger for informational output
   */
  constructor({ logger }) {
    this.logger = logger;
  }

  /**
   * Set up RPC handler to serve file streams to a newly connected peer.
   * @param {string} peerId - Hex string identifier of the peer
   * @param {RPC}    rpc    - RPC instance for messaging with that peer
   */
  handlePeerConnected(peerId, rpc) {
    rpc.respond(C.RPC.FILE_REQUEST, async ({ path }) => {
      this.logger.info(`Peer ${peerId} requested file: ${path}`);
      return fs.createReadStream(path);
    });
  }

  /**
   * Optional cleanup when a peer disconnects (no-op here).
   * @param {string} peerId - Hex string identifier of the peer
   */
  handlePeerDisconnected(peerId) {
    // No persistent resources to release
  }

  /**
   * Client-side helper: download a file from remote over RPC.
   * @param {RPC} rpc - RPC instance for the target peer
   * @param {string} remotePath - Path of the file on the remote peer
   * @param {WritableStream} destStream - Local writable stream to pipe data
   *    into
   * @returns {Promise<void>}
   */
  async download(rpc, remotePath, destStream) {
    const rs = await rpc.request(C.RPC.FILE_REQUEST, { path: remotePath });
    return new Promise((resolve, reject) => {
      rs.pipe(destStream).on("finish", resolve).on("error", reject);
    });
  }
}
