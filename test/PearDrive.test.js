import test, { solo, skip } from "brittle";
import fs from "fs";
import path from "path";
import createTestnet from "hyperdht/testnet.js";

import * as C from "../src/constants.js";
import * as utils from "./lib/utils.js";
const { txt } = utils;

////////////////////////////////////////////////////////////////////////////////
// Setup
////////////////////////////////////////////////////////////////////////////////

// Before running tests, clear any existing test data and ensure test folders
// exist
utils.clearTestData();
utils.createTestFolders();

////////////////////////////////////////////////////////////////////////////////
// PearDrive core functionality tests
////////////////////////////////////////////////////////////////////////////////

test(txt.main("PearDrive: Initialization"), { stealth: true }, async (t) => {
  const testnet = await createTestnet();
  const { bootstrap } = testnet;

  // Test initialization
  const { pd, localDrivePath, corestorePath, logPath } =
    await utils.createPearDrive({
      name: "init-test",
      bootstrap,
      onError: (err) => t.fail(txt.fail("onError called"), err),
    });
  t.teardown(() => {
    pd.close();
  });

  await pd.ready();
  t.pass("ready() completed");

  // Ensure valid save data
  const data = pd.getSaveData();
  t.is(data.watchPath, localDrivePath, "watchPath saved");
  t.is(data.corestorePath, corestorePath, "corestorePath saved");
  t.is(data.logOpts.logFilePath, logPath, "logFilePath saved");

  // Close the PearDrive instance
  await pd.close();
  t.pass("close() completed");

  // Create a new PearDrive instance with the same save data
  console.log("TODO test loading from save data");
});

////////////////////////////////////////////////////////////////////////////////
// Network connectivity tests
////////////////////////////////////////////////////////////////////////////////

test(
  txt.main("PearDrive: Create one-node network"),
  { stealth: true },
  async (t) => {
    const testnet = await createTestnet();
    const { bootstrap } = testnet;

    const { pd } = await utils.createPearDrive({
      name: "one-node",
      bootstrap,
      onError: (err) => t.fail(txt.fail("onError called"), err),
    });
    t.teardown(() => {
      pd.close();
    });
    await pd.ready();
    await pd.joinNetwork();

    t.ok(pd.connected, "PearDrive connected to network");
  }
);

test(
  txt.main("PearDrive: Create two-node network"),
  { stealth: true },
  async (t) => {
    const testnet = await createTestnet();
    const { bootstrap } = testnet;

    const [p1, p2] = await utils.createNetwork({
      baseName: "two-node",
      bootstrap,
      n: 2,
      onError: (err) => t.fail(txt.fail("onError called"), err),
    });
    t.teardown(() => {
      p1.pd.close();
      p2.pd.close();
    });
    await utils.wait(1);
    t.ok(p1.pd.connected && p2.pd.connected, "both peers connected");

    const peers1 = p1.pd.listPeers();
    const peers2 = p2.pd.listPeers();
    t.is(peers1.length, 1, "p1 sees 1 peer");
    t.is(peers2.length, 1, "p2 sees 1 peer");
  }
);

test(
  txt.main("PearDrive: Create five-node network"),
  { stealth: true },
  async (t) => {
    const testnet = await createTestnet();
    const { bootstrap } = testnet;

    // Spin up 5 peers
    const peerObjs = await utils.createNetwork("peer", bootstrap, 5);
    await utils.wait(1);
    const pds = peerObjs.map((p) => p.pd);

    // Teardown all peers
    t.teardown(async () => {
      for (const pd of pds) await pd.close();
    });

    // Ensure all are connected
    for (const pd of pds) {
      t.ok(pd.connected, "peer is connected");
    }

    // Each peer should see 4 other peers
    for (const pd of pds) {
      const peers = pd.listPeers();
      t.is(peers.length, 4, "peer sees 4 other peers");
    }
  }
);

////////////////////////////////////////////////////////////////////////////////
// Network Event Emitter tests
////////////////////////////////////////////////////////////////////////////////

test(txt.main("PearDrive: NETWORK events"), { stealth: true }, async (t) => {
  const testnet = await createTestnet();
  const { bootstrap } = testnet;

  const [pearDriveA, pearDriveB] = await utils.createNetwork({
    baseName: "network-events",
    bootstrap,
    n: 2,
    onError: (err) => t.fail(txt.fail("onError called"), err),
    indexOpts: {
      poll: false, // Disable polling for this test
      pollInterval: 500,
    },
  });
  t.teardown(async () => {
    pearDriveA.pd.close();
    pearDriveB.pd.close();
  });

  let networkAFired = false;
  let systemAFired = false;
  let networkBFired = false;
  let systemBFired = false;
  pearDriveA.pd.on(C.EVENT.NETWORK, () => {
    networkAFired = true;
  });
  pearDriveA.pd.on(C.EVENT.SYSTEM, () => {
    systemAFired = true;
  });
  pearDriveB.pd.on(C.EVENT.NETWORK, () => {
    networkBFired = true;
  });
  pearDriveB.pd.on(C.EVENT.SYSTEM, () => {
    systemBFired = true;
  });

  //
  // Test NETWORK event on file addition
  //

  utils.createRandomFile(pearDriveA.localDrivePath);
  await pearDriveA.pd.syncLocalFilesOnce();
  await utils.wait(1);

  t.ok(networkBFired, "NETWORK event fired on pearDriveB after file addition");
  t.ok(systemBFired, "SYSTEM event fired on pearDriveB after file addition");

  //
  // Test NETWORK event on file modification
  //

  networkBFired = false;
  systemBFired = false;

  const modifiedContent = "modified content";
  const filePath = path.join(pearDriveA.localDrivePath, "to-modify.txt");
  fs.writeFileSync(filePath, modifiedContent);
  await pearDriveA.pd.syncLocalFilesOnce();
  await utils.wait(1);

  t.ok(
    networkBFired,
    "NETWORK event fired on pearDriveB after file modification"
  );
  t.ok(
    systemBFired,
    "SYSTEM event fired on pearDriveB after file modification"
  );

  //
  // Test NETWORK event on file deletion
  //

  networkBFired = false;
  systemBFired = false;

  fs.unlinkSync(filePath);
  await pearDriveA.pd.syncLocalFilesOnce();
  await utils.wait(1);

  t.ok(networkBFired, "NETWORK event fired on pearDriveB after file deletion");
  t.ok(systemBFired, "SYSTEM event fired on pearDriveB after file deletion");
});

test(txt.main("PearDrive: PEER events"), { stealth: true }, async (t) => {
  const testnet = await createTestnet();
  const { bootstrap } = testnet;

  const pearDriveA = await utils.createPearDrive({
    name: "pearDriveA",
    bootstrap,
    onError: (err) => t.fail(txt.fail("onError called"), err),
  });
  const pearDriveB = await utils.createPearDrive({
    name: "pearDriveB",
    bootstrap,
    onError: (err) => t.fail(txt.fail("onError called"), err),
  });
  t.teardown(async () => {
    await pearDriveA.pd.close();
    await pearDriveB.pd.close();
  });
  await pearDriveA.pd.ready();
  await pearDriveB.pd.ready();

  let peerAFired = false;
  let systemAFired = false;
  let peerBFired = false;
  let systemBFired = false;
  pearDriveA.pd.on(C.EVENT.PEER, () => {
    peerAFired = true;
  });
  pearDriveA.pd.on(C.EVENT.SYSTEM, () => {
    systemAFired = true;
  });
  pearDriveB.pd.on(C.EVENT.PEER, () => {
    peerBFired = true;
  });
  pearDriveB.pd.on(C.EVENT.SYSTEM, () => {
    systemBFired = true;
  });

  //
  // Test PEER event on connect
  //
  await pearDriveA.pd.joinNetwork();
  await pearDriveB.pd.joinNetwork(pearDriveA.pd.networkKey);
  await utils.awaitAllConnected([pearDriveA.pd, pearDriveB.pd]);

  t.ok(peerAFired, "PEER event fired on pearDriveA");
  t.ok(systemAFired, "SYSTEM event fired on pearDriveA");
  t.ok(peerBFired, "PEER event fired on pearDriveB");
  t.ok(systemBFired, "SYSTEM event fired on pearDriveB");

  //
  // Test PEER event on disconnect
  //
  // Only look at peer A, because B will be removed from A's peer list
  peerAFired = false;
  systemAFired = false;
  await pearDriveB.pd.close();
  await utils.wait(1);
  t.ok(
    peerAFired,
    "PEER event fired on pearDriveA after pearDriveB disconnects"
  );
  t.ok(
    systemAFired,
    "SYSTEM event fired on pearDriveA after pearDriveB disconnects"
  );
});

test(txt.main("PearDrive: LOCAL events"), { stealth: true }, async (t) => {
  const testnet = await createTestnet();
  const { bootstrap } = testnet;

  const { pd, localDrivePath } = await utils.createPearDrive({
    name: "local-events",
    bootstrap,
    onError: (err) => t.fail(txt.fail("onError called"), err),
    indexOpts: {
      poll: false, // Disable polling for this test
      pollInterval: 500,
    },
  });
  t.teardown(() => pd.close());
  await pd.ready();

  //
  // Test file addition event
  //

  let localFired = false;
  let systemFired = false;
  pd.on(C.EVENT.LOCAL, () => {
    localFired = true;
  });
  pd.on(C.EVENT.SYSTEM, () => {
    systemFired = true;
  });

  const file = utils.createRandomFile(localDrivePath);
  await pd.syncLocalFilesOnce();

  t.ok(localFired, "LOCAL event fired on file addition");
  t.ok(systemFired, "SYSTEM event fired on file addition");

  //
  // Test file modification event
  //

  localFired = false;
  systemFired = false;

  const modifiedContent = "modified content";
  fs.writeFileSync(file.path, modifiedContent);
  await pd.syncLocalFilesOnce();

  t.ok(localFired, "LOCAL event fired on file modification");
  t.ok(systemFired, "SYSTEM event fired on file modification");

  //
  // Test file deletion event
  //

  localFired = false;
  systemFired = false;

  fs.unlinkSync(file.path);
  await pd.syncLocalFilesOnce();

  t.ok(localFired, "LOCAL event fired on file deletion");
  t.ok(systemFired, "SYSTEM event fired on file deletion");
});

///////////////////////////////////////////////////////////////////////////////
// Network communication tests
///////////////////////////////////////////////////////////////////////////////

test(txt.main("PearDrive: Custom message"), { stealth: true }, async (t) => {
  const testnet = await createTestnet();
  const { bootstrap } = testnet;

  const [peerA, peerB] = await utils.createNetwork({
    baseName: "custom-message",
    bootstrap,
    n: 2,
    onError: (err) => t.fail(txt.fail("onError called"), err),
    indexOpts: {
      poll: false, // Disable polling for this test
      pollInterval: 500,
    },
  });

  t.teardown(async () => {
    await peerA.pd.close();
    await peerB.pd.close();
  });

  let customRequestReceived = false;
  peerB.pd.on("custom_message", (_payload) => {
    customRequestReceived = true;
    return true;
  });

  const peerId = peerA.pd.listPeersStringified()[0].publicKey;
  const response = await peerA.pd.sendMessage(peerId, "custom_message", {
    data: "test",
  });
  t.ok(customRequestReceived, "Custom request received by pearDriveB");
  t.is(response, true, "Custom response received by pearDriveA");
});

////////////////////////////////////////////////////////////////////////////////
// File viewing tests
////////////////////////////////////////////////////////////////////////////////

test(txt.main("PearDrive: List local files"), { stealth: true }, async (t) => {
  const testnet = await createTestnet();
  const { bootstrap } = testnet;

  const { pd, localDrivePath } = await utils.createPearDrive({
    name: "list-local-files",
    bootstrap,
    onError: (err) => t.fail(txt.fail("onError called"), err),
    indexOpts: { poll: false, pollInterval: 500 },
  });
  t.teardown(() => pd.close());
  await pd.ready();

  // Create some files
  const files = [];
  for (let i = 0; i < 5; i++) {
    files.push(utils.createRandomFile(localDrivePath, 10));
  }
  await pd.syncLocalFilesOnce();

  // List local files
  const localFiles = await pd.listLocalFiles();
  t.is(
    localFiles.files.length,
    files.length,
    "Listed correct number of local files"
  );
  for (const file of files) {
    t.ok(
      localFiles.files.some((f) => f.path === file.name),
      `File ${file.name} is listed`
    );
  }
});

test(
  txt.main("PearDrive: List network files"),
  { stealth: true },
  async (t) => {
    const testnet = await createTestnet();
    const { bootstrap } = testnet;

    const [pearDriveA, pearDriveB] = await utils.createNetwork({
      baseName: "list-network-files",
      bootstrap,
      n: 2,
      onError: (err) => t.fail(txt.fail("onError called"), err),
      indexOpts: {
        poll: false, // Disable polling for this test
        pollInterval: 500,
      },
    });
    t.teardown(async () => {
      await pearDriveA.pd.close();
      await pearDriveB.pd.close();
    });

    // Create files on pearDriveA
    const filesA = [];
    for (let i = 0; i < 5; i++) {
      filesA.push(utils.createRandomFile(pearDriveA.pd.watchPath, 10));
    }
    await pearDriveA.pd.syncLocalFilesOnce();

    // Create files on pearDriveB
    const filesB = [];
    for (let i = 0; i < 3; i++) {
      filesB.push(utils.createRandomFile(pearDriveB.pd.watchPath, 10));
    }
    await pearDriveB.pd.syncLocalFilesOnce();

    // Test file indexing on pearDriveB
    const pearDriveAkey = pearDriveA.pd.publicKey;
    const networkFilesB = await pearDriveB.pd.listNetworkFiles();

    t.is(
      networkFilesB.get("local").files.length,
      filesB.length,
      "Listed correct number of local network files"
    );
    t.is(
      networkFilesB.get(pearDriveAkey).files.length,
      filesA.length,
      "Listed correct number of remote network files"
    );
    for (const file of networkFilesB.get("local").files) {
      t.ok(
        filesB.some((f) => f.name === file.path),
        `File ${file.path} is listed in local network files`
      );
    }
    for (const file of networkFilesB.get(pearDriveAkey).files) {
      t.ok(
        filesA.some((f) => f.name === file.path),
        `File ${file.path} is listed in remote network files`
      );
    }

    // Test file indexing on pearDriveA
    const pearDriveBkey = pearDriveB.pd.publicKey;
    const networkFilesA = await pearDriveA.pd.listNetworkFiles();
    t.is(
      networkFilesA.get("local").files.length,
      filesA.length,
      "Listed correct number of local network files"
    );
    t.is(
      networkFilesA.get(pearDriveBkey).files.length,
      filesB.length,
      "Listed correct number of remote network files"
    );
    for (const file of networkFilesA.get("local").files) {
      t.ok(
        filesA.some((f) => f.name === file.path),
        `File ${file.path} is listed in local network files`
      );
    }
    for (const file of networkFilesA.get(pearDriveBkey).files) {
      t.ok(
        filesB.some((f) => f.name === file.path),
        `File ${file.path} is listed in remote network files`
      );
    }
  }
);

test(
  txt.main("PearDrive: Test single file download"),
  { stealth: true },
  async (t) => {
    const testnet = await createTestnet();
    const { bootstrap } = testnet;

    const [peerA, peerB] = await utils.createNetwork({
      baseName: "file-download-test",
      bootstrap,
      n: 2,
      onError: (err) => t.fail(txt.fail("onError called"), err),
      indexOpts: {
        poll: false, // Disable polling for this test
        pollInterval: 500,
      },
    });
    t.teardown(async () => {
      await peerA.pd.close();
      await peerB.pd.close();
    });

    // Create a file on pearDriveA
    const fileA = utils.createRandomFile(peerA.pd.watchPath, 10);
    await peerA.pd.syncLocalFilesOnce();
    await peerB.pd.syncLocalFilesOnce();

    // Get hash of the filefrom peerA
    const files = await peerA.pd.listLocalFiles();
    const fileEntry = files.files.find((f) => f.path === fileA.name);
    const fileHash = fileEntry.hash;

    // Download the file from pearDriveB
    await peerB.pd.downloadFileFromPeer(peerA.pd.publicKey, fileA.name);
    await peerB.pd.syncLocalFilesOnce();

    // Ensure the file was downloaded correctly
    const peerBLocalFiles = await peerB.pd.listLocalFiles();
    const downloadedFile = peerBLocalFiles.files.find(
      (f) => f.path === fileA.name
    );
    const downloadedFileHash = downloadedFile.hash;

    t.is(downloadedFileHash, fileHash, "Downloaded file hash matches original");
  }
);

test(
  txt.main("PearDrive: Download five files"),
  { stealth: true },
  async (t) => {
    const testnet = await createTestnet();
    const { bootstrap } = testnet;

    const [peerA, peerB] = await utils.createNetwork({
      baseName: "file-download-five-test",
      bootstrap,
      n: 2,
      onError: (err) => t.fail(txt.fail("onError called"), err),
      indexOpts: {
        poll: false, // Disable polling for this test
        pollInterval: 500,
      },
    });
    t.teardown(async () => {
      await peerA.pd.close();
      await peerB.pd.close();
    });

    // Create 5 files on peerA
    const filesA = [];
    for (let i = 0; i < 5; i++) {
      filesA.push(utils.createRandomFile(peerA.pd.watchPath, 10));
    }
    await peerA.pd.syncLocalFilesOnce();

    // Download all files from peerB
    for (const file of filesA) {
      await peerB.pd.downloadFileFromPeer(peerA.pd.publicKey, file.name);
      await peerB.pd.syncLocalFilesOnce();
    }

    // Ensure all files were downloaded correctly
    const peerBLocalFiles = await peerB.pd.listLocalFiles();
    t.is(
      peerBLocalFiles.files.length,
      filesA.length,
      "All files downloaded to peerB"
    );
    for (const file of filesA) {
      const downloadedFile = peerBLocalFiles.files.find(
        (f) => f.path === file.name
      );
      t.ok(downloadedFile, `File ${file.name} downloaded to peerB`);
      t.is(
        downloadedFile.hash,
        file.hash,
        `Downloaded file ${file.name} hash matches original`
      );
    }
  }
);

skip(
  txt.main("PearDrive: Test file downloading with relay"),
  { stealth: false },
  async (t) => {
    const testnet = await createTestnet();
    const { bootstrap } = testnet;

    const [peerA, peerB] = await utils.createNetwork({
      baseName: "file-download-relay-test",
      bootstrap,
      n: 2,
      onError: (err) => t.fail(txt.fail("onError called"), err),
      indexOpts: {
        poll: true,
        pollInterval: 500,
        relay: true, // Enable relay mode
      },
    });
    t.teardown(async () => {
      await peerA.pd.close();
      await peerB.pd.close();
    });

    // Create 2 files on peerA
    const fileA1 = utils.createRandomFile(peerA.pd.watchPath, 10);
    const fileA2 = utils.createRandomFile(peerA.pd.watchPath, 10);

    await utils.wait(3);

    const filesInB = await peerB.pd.listLocalFiles();
    console.log("Files in peerB", filesInB);
  }
);
