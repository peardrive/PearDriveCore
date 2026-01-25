import test from "brittle";
import fs from "fs";
import createTestnet from "hyperdht/testnet.js";

import * as C from "./src/constants.js";
import * as utils from "./test/lib/utils/index.js";

// Test chunked downloads using the EXACT pattern from working tests
test("Chunked Download: Following exact working pattern", async (t) => {
  const { bootstrap } = await createTestnet();
  
  // Clear test data first
  utils.clearTestData();
  utils.createTestFolders();

  // Use the EXACT same network creation pattern as working tests
  const [peerA, peerB] = await utils.createNetwork({
    baseName: "chunked-download-proper-test",
    bootstrap,
    n: 2,
    onError: (err) => t.fail("onError called", err),
    indexOpts: {
      disableWatching: true,
    },
  });
  
  t.teardown(async () => {
    await peerA.pd.close();
    await peerB.pd.close();
  });

  let downloadCompleted = false;

  // Set up the SAME event-driven pattern as successful tests
  peerB.pd.on(C.EVENT.PEER_FILE_ADDED, async (_data) => {
    try {
      console.log("PEER_FILE_ADDED event fired - starting download...");
      
      // Use downloadFileFromPeer (which internally calls my chunked implementation)
      await peerB.pd.downloadFileFromPeer(peerA.pd.publicKey, "chunked_test_large.txt");
      await peerB.pd._syncLocalFilesOnce();

      console.log("Download and sync completed");

      // Get hash of the file from peerA
      const files = await peerA.pd.listLocalFiles();
      const fileEntry = files.find((f) => f.path === "chunked_test_large.txt");
      const fileHash = fileEntry.hash;
      console.log(`Original file hash: ${fileHash}`);

      // Check if file exists on disk first
      const expectedPath = peerB.pd.watchPath + "/chunked_test_large.txt";
      const fileExistsOnDisk = fs.existsSync(expectedPath);
      console.log(`File exists on disk: ${fileExistsOnDisk}`);
      
      if (fileExistsOnDisk) {
        const stats = fs.statSync(expectedPath);
        console.log(`File size on disk: ${stats.size} bytes`);
      }

      // Ensure the file was downloaded correctly
      const peerBLocalFiles = await peerB.pd.listLocalFiles();
      console.log(`Peer B files after download:`, peerBLocalFiles.map(f => `${f.path} (${f.size} bytes)`));
      
      const downloadedFile = peerBLocalFiles.find((f) => f.path === "chunked_test_large.txt");
      
      if (!downloadedFile) {
        t.fail("Downloaded file not found in peer B local files");
        return;
      }
      
      const downloadedFileHash = downloadedFile.hash;
      console.log(`Downloaded file hash: ${downloadedFileHash}`);

      t.is(downloadedFileHash, fileHash, "Downloaded file hash matches original");
      
      downloadCompleted = true;
      console.log("✅ Chunked download test PASSED!");
      
    } catch (err) {
      t.fail(`Download failed: ${err.message}`);
    }
  });

  // Create a large file (>64KB) on peerA to force chunking - AFTER setting up listener
  console.log("Creating large test file...");
  const testContent = 'x'.repeat(128 * 1024); // 128KB file to force multiple 64KB chunks
  const testFilePath = utils.createRandomFile(peerA.pd.watchPath, testContent.length);
  
  // Rename to a predictable name
  const finalPath = peerA.pd.watchPath + "/chunked_test_large.txt";
  fs.renameSync(testFilePath.path, finalPath);
  
  console.log(`Created test file: ${testContent.length} bytes`);

  // Sync peerA - this should trigger PEER_FILE_ADDED on peerB
  console.log("Syncing peer A to trigger file discovery...");
  await peerA.pd._syncLocalFilesOnce();
  
  // Wait up to 10 seconds for download to complete
  await utils.waitFor(() => downloadCompleted, 10000, 100);
  
  if (!downloadCompleted) {
    t.fail("Download did not complete within timeout");
  }
});