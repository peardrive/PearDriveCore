import { waitFor } from "./waitFor.js";

/**
 * Resolves when given array of PearDrives are all connected
 *
 * @param {PearDrive[]} instances - Array of PearDrive instances
 * @param {number} timeout - Maximum time to wait for all instances to connect
 *
 * @returns {Promise} - Resolves when all instances are connected or rejects on
 * timeout
 */
export async function awaitAllConnected(instances, timeout = 60000) {
  // Flush all peers
  await Promise.all(instances.map((instance) => instance._swarm.flush()));

  // Wait for connected status to activate
  const connected = waitFor(() => {
    instances.every((instance) => instance.connected, timeout, 50);
  });

  return connected;
}
