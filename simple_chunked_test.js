import fs from "fs";
import path from "path";
import PearDrive from "./src/PearDrive.js";

// Simple direct test of chunked download without test framework overhead
async function testChunkedDownload() {
  console.log("Starting simple chunked download test...");
  
  try {
    // Create test directories
    const baseDir = "/tmp/peardrive_simple_test";
    const peerADir = path.join(baseDir, "peerA");
    const peerBDir = path.join(baseDir, "peerB");
    const corestoreADir = path.join(baseDir, "corestoreA");
    const corestoreBDir = path.join(baseDir, "corestoreB");
    
    // Clean up and recreate
    if (fs.existsSync(baseDir)) {
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
    fs.mkdirSync(peerADir, { recursive: true });
    fs.mkdirSync(peerBDir, { recursive: true });
    fs.mkdirSync(corestoreADir, { recursive: true });
    fs.mkdirSync(corestoreBDir, { recursive: true });
    
    // Create test file on peer A (larger than 64KB to test chunking)
    const testFileName = "test_large_file.txt";
    const testContent = "This is test data. ".repeat(5000); // ~100KB
    const testFilePath = path.join(peerADir, testFileName);
    fs.writeFileSync(testFilePath, testContent);
    
    console.log(`Created test file: ${testContent.length} bytes`);
    
    // Create PearDrive instances
    console.log("Creating PearDrive instances...");
    
    const peerA = new PearDrive({
      watchPath: peerADir,
      corestorePath: corestoreADir,
      bootstrap: [], // Empty bootstrap for isolated test
      indexOpts: { disableWatching: true }
    });
    
    const peerB = new PearDrive({
      watchPath: peerBDir,
      corestorePath: corestoreBDir,
      bootstrap: [], // Empty bootstrap for isolated test  
      indexOpts: { disableWatching: true }
    });
    
    // Initialize both peers
    await peerA.ready();
    await peerB.ready();
    
    console.log("PearDrive instances ready");
    console.log(`Peer A key: ${peerA.publicKey}`);
    console.log(`Peer B key: ${peerB.publicKey}`);
    
    // Sync peer A's local files
    await peerA._syncLocalFilesOnce();
    const filesA = await peerA.listLocalFiles();
    console.log(`Peer A local files:`, filesA.map(f => `${f.path} (${f.size} bytes)`));
    
    const originalFile = filesA.find(f => f.path === testFileName);
    if (!originalFile) {
      throw new Error("Test file not found in peer A's index");
    }
    
    console.log(`Original file hash: ${originalFile.hash}`);
    
    // Test direct peer download (this will internally use my chunked download implementation)
    console.log("Testing chunked download via downloadFileFromPeer...");
    await peerB.downloadFileFromPeer(peerA.publicKey, testFileName);
    
    console.log("Download completed successfully");
    
    // Verify the file exists and is correct
    const downloadedPath = path.join(peerBDir, testFileName);
    if (!fs.existsSync(downloadedPath)) {
      throw new Error("Downloaded file does not exist on disk");
    }
    
    const downloadedContent = fs.readFileSync(downloadedPath, 'utf8');
    if (downloadedContent !== testContent) {
      throw new Error(`Content mismatch: expected ${testContent.length} chars, got ${downloadedContent.length} chars`);
    }
    
    // Sync peer B and check local index
    await peerB._syncLocalFilesOnce();
    const filesB = await peerB.listLocalFiles();
    console.log(`Peer B local files:`, filesB.map(f => `${f.path} (${f.size} bytes)`));
    
    const downloadedFile = filesB.find(f => f.path === testFileName);
    if (downloadedFile) {
      console.log(`Downloaded file hash: ${downloadedFile.hash}`);
      if (downloadedFile.hash === originalFile.hash) {
        console.log("✅ Hash verification successful!");
      } else {
        console.log("❌ Hash mismatch!");
      }
    }
    
    console.log("✅ Chunked download test PASSED!");
    
    // Cleanup
    await peerA.close();
    await peerB.close();
    
    return true;
    
  } catch (error) {
    console.error("❌ Test failed:", error);
    return false;
  }
}

// Run the test
testChunkedDownload().then(success => {
  process.exit(success ? 0 : 1);
}).catch(err => {
  console.error("Test crashed:", err);
  process.exit(1);
});