import test from "brittle";
import fs from "fs";
import path from "path";
import createTestnet from "hyperdht/testnet.js";

import * as C from "./src/constants.js";
import * as utils from "./test/lib/utils/index.js";

// Simple test to verify chunked downloads work with direct peer downloads
test("Chunked Download: Direct peer download verification", async (t) => {
  const { bootstrap } = await createTestnet();
  
  // Clear any existing test data
  utils.clearTestData();
  utils.createTestFolders();

  const [peerA, peerB] = await utils.createNetwork({
    baseName: "chunked-download-test",
    bootstrap,
    n: 2,
    onError: (err) => t.fail("onError called", err),
    indexOpts: {
      disableWatching: true,
    },
  });

  t.teardown(async () => {
    try {
      await peerA.pd.close();
    } catch {}
    try {
      await peerB.pd.close();
    } catch {}
  });

  // Create a test file on peer A (larger than 64KB to force chunking)
  const testContent = 'x'.repeat(128 * 1024); // 128KB file
  const testFile = path.join(peerA.pd.watchPath, 'chunked_test_file.txt');
  fs.writeFileSync(testFile, testContent);
  
  // Sync peer A's local index
  await peerA.pd._syncLocalFilesOnce();
  
  // Get the original file hash
  const filesA = await peerA.pd.listLocalFiles();
  const originalFile = filesA.find(f => f.path === 'chunked_test_file.txt');
  t.ok(originalFile, "Original file indexed on peer A");
  
  console.log(`Original file size: ${originalFile.size} bytes`);
  console.log(`Original file hash: ${originalFile.hash}`);
  
  // Download directly from peer A to peer B (bypassing peer discovery)
  console.log("Starting direct peer download...");
  
  try {
    await peerB.pd.downloadFileFromPeer(peerA.pd.publicKey, 'chunked_test_file.txt');
    console.log("Download completed");
  } catch (err) {
    t.fail(`Download failed: ${err.message}`);
    return;
  }
  
  // Sync peer B's local index
  await peerB.pd._syncLocalFilesOnce();
  
  // Verify the downloaded file
  const filesB = await peerB.pd.listLocalFiles();
  const downloadedFile = filesB.find(f => f.path === 'chunked_test_file.txt');
  
  if (!downloadedFile) {
    console.log("Available files on peer B:", filesB.map(f => f.path));
    t.fail("Downloaded file not found in peer B's local files");
    return;
  }
  
  console.log(`Downloaded file size: ${downloadedFile.size} bytes`);
  console.log(`Downloaded file hash: ${downloadedFile.hash}`);
  
  // Verify file integrity
  t.is(downloadedFile.hash, originalFile.hash, "File hashes match");
  t.is(downloadedFile.size, originalFile.size, "File sizes match");
  
  // Verify file content on disk
  const downloadedPath = path.join(peerB.pd.watchPath, 'chunked_test_file.txt');
  t.ok(fs.existsSync(downloadedPath), "Downloaded file exists on disk");
  
  const downloadedContent = fs.readFileSync(downloadedPath, 'utf8');
  t.is(downloadedContent.length, testContent.length, "Content length matches");
  t.is(downloadedContent, testContent, "Content matches exactly");
  
  t.pass("Chunked download completed successfully");
});