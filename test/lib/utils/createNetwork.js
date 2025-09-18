import { createPearDrive } from "./createPearDrive.js";
import { awaitAllConnected } from "./awaitAllConnected.js";

/**
 * Creates a network of n PearDrive peers, each with its own storage folders.
 *
 * @param {Object} opts - Options for network creation
 *    @param {string} opts.baseName - Base name for each peer's folders
 *    @param {Array} opts.bootstrap - DHT bootstrap nodes
 *    @param {number} opts.n - Number of peers to create
 *    @param {Function} [opts.onError] - Optional error callback
 *    @param {Object} [opts.indexOpts] - Optional index options
 *
 * @returns {Promise<Object[]>} - Array of PearDrive descriptor objects { pd,
 *  watchPath, corestorePath, logPath }
 */
export async function createNetwork({
  baseName,
  bootstrap,
  n,
  onError = () => {},
  indexOpts = {
    disablePolling: false,
    pollInterval: 500,
  },
}) {
  const peers = [];
  for (let i = 0; i < n; i++) {
    const name = `${baseName}${i}`;
    const peer = await createPearDrive({
      name,
      bootstrap,
      onError,
      indexOpts,
    });
    await peer.pd.ready();
    if (i === 0) {
      await peer.pd.joinNetwork();
    } else {
      await peer.pd.joinNetwork(peers[0].pd.networkKey);
    }
    peers.push(peer);
  }

  await awaitAllConnected(peers.map((p) => p.pd));
  return peers;
}
