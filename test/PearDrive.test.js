import test, { solo, skip } from "brittle";
import fs from "fs";
import path from "path";
import createTestnet from "hyperdht/testnet.js";

import * as C from "../src/constants.js";
import * as utils from "./lib/utils/index.js";
import PearDrive from "../src/PearDrive.js";

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

test("PearDrive: Initialization", async (t) => {
  const { bootstrap } = await createTestnet();

  let pd1, pd2, pd3, pd4, pd5;
  let data, saveData, loadData;

  await t.test("Create PearDrive instance", async (subtest) => {
    try {
      const { pd, watchPath, corestorePath, logPath } =
        await utils.createPearDrive({
          name: "init-test",
          bootstrap,
          onError: (err) => t.fail("onError called", err),
        });

      pd1 = pd;
      data = {
        watchPath,
        corestorePath,
        logFilePath: logPath,
      };

      await pd1.ready();

      subtest.pass("PearDrive instance created successfully");
    } catch (err) {
      subtest.fail("Failed to create PearDrive instance", err);
    }
  });

  await t.test("Get save data", async (subtest) => {
    try {
      saveData = pd1.saveData;
      subtest.is(saveData.watchPath, data.watchPath, "watchPath saved");
      subtest.is(
        saveData.corestorePath,
        data.corestorePath,
        "corestorePath saved"
      );
      subtest.is(
        saveData.logOpts.logFilePath,
        data.logFilePath,
        "logFilePath saved"
      );
    } catch (err) {
      subtest.fail("Failed to get save data", err);
    }
  });

  await t.test("Graceful teardown", async (subtest) => {
    try {
      await pd1.close();
      subtest.pass("PearDrive instance closed successfully");
    } catch (err) {
      subtest.fail("Failed to close PearDrive instance", err);
    } finally {
      pd1 = null;
    }
  });

  await t.test("Reload PearDrive instance from save data", async (subtest) => {
    try {
      pd1 = new PearDrive(saveData);
      await pd1.ready();
      loadData = pd1.saveData;
      subtest.ok(utils.deepEqual(loadData, saveData), "Save data matches");
    } catch (err) {
      subtest.fail("Failed to reload PearDrive instance", err);
    }
  });

  await t.test("Join a single-node network", async (subtest) => {
    try {
      await pd1.joinNetwork();
      await utils.waitFor(() => pd1.connected, 5000, 50);
      subtest.ok(pd1.connected, "PearDrive connected to single-node network");
    } catch (err) {
      subtest.fail("Failed to join single-node network", err);
    } finally {
      await pd1?.close();
      pd1 = null;
    }
  });

  await t.test("Join a two-node network", async (subtest) => {
    try {
      [pd1, pd2] = await utils.createNetwork({
        baseName: "two-node-test",
        bootstrap,
        n: 2,
        onError: (err) => subtest.fail("onError called", err),
      });

      pd1 = pd1.pd;
      pd2 = pd2.pd;
      subtest.teardown(async () => {
        await pd1.close();
        await pd2.close();
        pd1 = null;
        pd2 = null;
      });

      subtest.ok(pd1.connected, "PearDrive connected to two-node network");
      subtest.ok(pd2.connected, "PearDrive connected to two-node network");
    } catch (err) {
      subtest.fail("Failed to join two-node network", err);
    }
  });

  await t.test("Join a five-node network", async (subtest) => {
    try {
      [pd1, pd2, pd3, pd4, pd5] = await utils.createNetwork({
        baseName: "five-node-test",
        bootstrap,
        n: 5,
        onError: (err) => t.fail("onError called", err),
      });

      pd1 = pd1.pd;
      pd2 = pd2.pd;
      pd3 = pd3.pd;
      pd4 = pd4.pd;
      pd5 = pd5.pd;
      subtest.teardown(async () => {
        await pd1.close();
        await pd2.close();
        await pd3.close();
        await pd4.close();
        await pd5.close();
        pd1 = null;
        pd2 = null;
        pd3 = null;
        pd4 = null;
        pd5 = null;
      });

      subtest.ok(pd1.connected, "PearDrive 1 connected to five-node network");
      subtest.ok(pd2.connected, "PearDrive 2 connected to five-node network");
      subtest.ok(pd3.connected, "PearDrive 3 connected to five-node network");
      subtest.ok(pd4.connected, "PearDrive 4 connected to five-node network");
      subtest.ok(pd5.connected, "PearDrive 5 connected to five-node network");
    } catch (err) {
      subtest.fail("Failed to join five-node network", err);
    }
  });
});

////////////////////////////////////////////////////////////////////////////////
// PearDrive Event Emitter tests
////////////////////////////////////////////////////////////////////////////////

test("PearDrive: Local file events", async (t) => {
  const { bootstrap } = await createTestnet();

  let pd1;
  let pd1data;
  let file;

  // Set up PearDrive instance
  const { pd, watchPath, corestorePath, logPath } = await utils.createPearDrive(
    {
      name: "local-file-events",
      bootstrap,
      onError: (err) => t.fail("onError called", err),
      indexOpts: {
        disablePolling: true,
      },
    }
  );
  pd1 = pd;
  pd1data = {
    watchPath,
    corestorePath,
    logFilePath: logPath,
  };
  await pd1.ready();

  // Test LOCAL_FILE_ADDED event
  await t.test("LOCAL_FILE_ADDED event", async (subtest) => {
    let hookFired = false;

    try {
      // Add event hook
      pd1.on(C.EVENT.LOCAL_FILE_ADDED, (data) => {
        hookFired = true;
        subtest.pass("LOCAL_FILE_ADDED event fired");
      });

      // Create a file
      file = utils.createRandomFile(watchPath);
      await pd1._syncLocalFilesOnce();

      // 5 second max wait timeout, fails if event not fired
      await utils.wait(5);
      if (!hookFired) subtest.fail("LOCAL_FILE_ADDED event not fired");
    } catch (error) {
      subtest.fail("Error occurred", error);
    }
  });

  // Test LOCAL_FILE_CHANGED event
  await t.test("LOCAL_FILE_CHANGED event", async (subtest) => {
    let hookFired = false;
    try {
      // Add event hook
      pd1.on(C.EVENT.LOCAL_FILE_CHANGED, (data) => {
        hookFired = true;
        subtest.pass("LOCAL_FILE_CHANGED event fired");
      });

      // Modify the file
      const modifiedContent = "modified content";
      fs.writeFileSync(file.path, modifiedContent);
      await pd1._syncLocalFilesOnce();

      // 5 second max wait timeout, fails if event not fired
      await utils.wait(5);
      if (!hookFired) subtest.fail("LOCAL_FILE_CHANGED event not fired");
    } catch (error) {
      subtest.fail("Error occurred", error);
    }
  });

  // Test LOCAL_FILE_REMOVED event
  await t.test("LOCAL_FILE_REMOVED event", async (subtest) => {
    let hookFired = false;
    try {
      // Add event hook
      pd1.on(C.EVENT.LOCAL_FILE_REMOVED, (data) => {
        hookFired = true;
        subtest.pass("LOCAL_FILE_REMOVED event fired");
      });

      // Remove the file
      fs.unlinkSync(file.path);
      await pd1._syncLocalFilesOnce();

      // 5 second max wait timeout, fails if event not fired
      await utils.wait(5);
      if (!hookFired) subtest.fail("LOCAL_FILE_REMOVED event not fired");
    } catch (error) {
      subtest.fail("Error occurred", error);
    }
  });
});

test("PearDrive: Peer file events", async (t) => {
  const { bootstrap } = await createTestnet();

  const [peerA, peerB] = await utils.createNetwork({
    baseName: "peer-file-events",
    bootstrap,
    n: 2,
    onError: (err) => t.fail("onError called", err),
    indexOpts: {
      // keep polling off so we control sync points deterministically
      disablePolling: true,
    },
  });

  t.teardown(async () => {
    await peerA.pd.close();
    await peerB.pd.close();
  });

  let file;
  let filePath;
  let peerKeyOnA = peerA.pd.publicKey;
  let peerKeyOnB = peerB.pd.publicKey;
  let firstHash;
  let secondHash;

  // Test PEER_FILE_ADDED event
  await t.test("PEER_FILE_ADDED event", async (subtest) => {
    let hookFired = false;

    // Listen on peer A for peer events about peer B’s files
    peerA.pd.once(C.EVENT.PEER_FILE_ADDED, async (data) => {
      try {
        hookFired = true;

        // Basic shape checks
        subtest.ok(typeof data.filePath === "string", "has filePath");
        subtest.ok(typeof data.peerKey === "string", "has peerKey");
        subtest.ok(!!data.hash, "has hash");

        // Stash for next tests
        filePath = data.filePath;
        peerKeyOnA = data.peerKey;
        firstHash = data.hash;

        subtest.pass("PEER_FILE_ADDED event fired");
      } catch (e) {
        subtest.fail("Bad payload for PEER_FILE_ADDED", e);
      }
    });

    // Create a file on peer B and sync its local index
    file = utils.createRandomFile(peerB.pd.watchPath);
    await peerB.pd._syncLocalFilesOnce();

    // give replication/diff a moment to propagate
    await utils.wait(5);
    if (!hookFired) subtest.fail("PEER_FILE_ADDED event not fired, timed out");
  });

  // Test PEER_FILE_CHANGED event
  await t.test("PEER_FILE_CHANGED event", async (subtest) => {
    let hookFired = false;

    peerA.pd.once(C.EVENT.PEER_FILE_CHANGED, (data) => {
      try {
        hookFired = true;

        subtest.is(
          data.peerKey,
          peerKeyOnB,
          "peerKey matches the remote peer index key"
        );
        subtest.is(
          data.filePath,
          filePath,
          "filePath matches the previously added file"
        );
        subtest.ok(!!data.hash, "has new hash");
        subtest.ok(!!data.prevHash, "has prevHash");
        subtest.not(data.hash, data.prevHash, "hash changed from prevHash");

        secondHash = data.hash;

        subtest.pass("PEER_FILE_CHANGED event fired");
      } catch (e) {
        subtest.fail("Bad payload for PEER_FILE_CHANGED", data, e);
      }
    });

    // Modify the file on peer B and sync
    fs.writeFileSync(file.path, "modified content " + Date.now());
    await peerB.pd._syncLocalFilesOnce();

    await utils.wait(5);

    if (!hookFired) subtest.fail("PEER_FILE_CHANGED event not fired");
    else if (firstHash && secondHash) {
      subtest.not(firstHash, secondHash, "content hash actually changed");
    }
  });

  // Test PEER_FILE_REMOVED event
  await t.test("PEER_FILE_REMOVED event", async (subtest) => {
    let hookFired = false;

    peerA.pd.once(C.EVENT.PEER_FILE_REMOVED, (data) => {
      try {
        hookFired = true;

        subtest.is(
          data.peerKey,
          peerKeyOnA,
          "peerKey matches the remote peer index key"
        );
        subtest.is(
          data.filePath,
          filePath,
          "filePath matches the previously tracked file"
        );
        subtest.ok(!("hash" in data), "no hash on removed");
        subtest.ok(!("prevHash" in data), "no prevHash on removed");

        subtest.pass("PEER_FILE_REMOVED event fired");
      } catch (e) {
        subtest.fail("Bad payload for PEER_FILE_REMOVED", e);
      }
    });

    // Delete the file on peer B and sync
    fs.unlinkSync(file.path);
    await peerB.pd._syncLocalFilesOnce();

    await utils.wait(5);

    if (!hookFired) subtest.fail("PEER_FILE_REMOVED event not fired");
  });
});

test("PearDrive: Peer connection events", async (t) => {
  const { bootstrap } = await createTestnet();

  const onError = (err) => t.fail("onError called", err);

  // Ready Peer A
  const A = await utils.createPearDrive({
    name: "peer-conn-A",
    bootstrap,
    onError,
    indexOpts: { disablePolling: true },
  });
  const pdA = A.pd;
  await pdA.ready();

  // Create network with peer A
  await pdA.joinNetwork();
  const topic = pdA.networkKey;

  // Ready Peer B
  const B = await utils.createPearDrive({
    name: "peer-conn-B",
    bootstrap,
    onError,
    indexOpts: { disablePolling: true },
  });
  const pdB = B.pd;
  await pdB.ready();

  t.teardown(async () => {
    try {
      await pdB.close();
    } catch {}
    try {
      await pdA.close();
    } catch {}
  });

  await t.test("PEER_CONNECTED events fire on both sides", async (subtest) => {
    subtest.plan(6);
    let aSawB = false;
    let bSawA = false;

    // A should see B connect
    pdA.once(C.EVENT.PEER_CONNECTED, (peerId) => {
      try {
        subtest.ok(typeof peerId === "string", "A received peerId as string");
        subtest.is(peerId, pdB.publicKey, "A saw B's public key");
        aSawB = true;
        subtest.pass("PEER_CONNECTED (A observed B) fired");
      } catch (e) {
        subtest.fail("Bad payload for PEER_CONNECTED on A", e);
      }
    });

    // B should see A connect
    pdB.once(C.EVENT.PEER_CONNECTED, (peerId) => {
      try {
        subtest.ok(typeof peerId === "string", "B received peerId as string");
        subtest.is(peerId, pdA.publicKey, "B saw A's public key");
        bSawA = true;
        subtest.pass("PEER_CONNECTED (B observed A) fired");
      } catch (e) {
        subtest.fail("Bad payload for PEER_CONNECTED on B", e);
      }
    });

    // Now connect B to A’s network (triggers both connect events)
    await pdB.joinNetwork(topic);

    await utils.wait(5);
    if (!aSawB) subtest.fail("PEER_CONNECTED not fired on A (timed out)");
    if (!bSawA) subtest.fail("PEER_CONNECTED not fired on B (timed out)");
  });

  await t.test(
    "PEER_DISCONNECTED event (A observes B leaving)",
    async (subtest) => {
      subtest.plan(3);
      let aSawDisconnect = false;

      pdA.once(C.EVENT.PEER_DISCONNECTED, (peerId) => {
        try {
          subtest.ok(typeof peerId === "string", "A received peerId as string");
          subtest.is(peerId, pdB.publicKey, "A saw B disconnect");
          aSawDisconnect = true;
          subtest.pass("PEER_DISCONNECTED (A observed B) fired");
        } catch (e) {
          subtest.fail("Bad payload for PEER_DISCONNECTED on A", e);
        }
      });

      // Leave by closing peer B
      await pdB.close();

      await utils.wait(5);
      if (!aSawDisconnect)
        subtest.fail("PEER_DISCONNECTED not fired on A (timed out)");
    }
  );

  await t.test(
    "PEER_DISCONNECTED event (B observes A leaving)",
    async (subtest) => {
      subtest.plan(3);

      // Bring up a fresh B2 so we can test the reverse direction cleanly
      const B2 = await utils.createPearDrive({
        name: "peer-conn-B2",
        bootstrap,
        onError,
        indexOpts: { disablePolling: true },
      });
      const pdB2 = B2.pd;
      await pdB2.ready();

      // Reconnect to A’s topic
      await pdB2.joinNetwork(topic);
      await utils.wait(1);

      let bSawDisconnect = false;

      pdB2.once(C.EVENT.PEER_DISCONNECTED, (peerId) => {
        try {
          subtest.ok(
            typeof peerId === "string",
            "B2 received peerId as string"
          );
          subtest.is(peerId, pdA.publicKey, "B2 saw A disconnect");
          bSawDisconnect = true;
          subtest.pass("PEER_DISCONNECTED (B2 observed A) fired");
        } catch (e) {
          subtest.fail("Bad payload for PEER_DISCONNECTED on B2", e);
        }
      });

      // Now have A leave
      await pdA.close();

      await utils.wait(5);
      if (!bSawDisconnect)
        subtest.fail("PEER_DISCONNECTED not fired on B2 (timed out)");

      // Cleanup B2 (A already closed)
      await pdB2.close();
    }
  );
});

////////////////////////////////////////////////////////////////////////////////
// Save data update event
////////////////////////////////////////////////////////////////////////////////

solo("PearDrive: Save data update event", async (t) => {
  const { bootstrap } = await createTestnet();

  const [peerA, peerB] = await utils.createNetwork({
    baseName: "custom-message",
    bootstrap,
    n: 2,
    onError: (err) => t.fail("onError called", err),
    indexOpts: {
      disablePolling: true, // Disable polling for this test
      pollInterval: 500,
    },
  });

  t.teardown(async () => {
    await peerA.pd.close();
    await peerB.pd.close();
  });

  await t.test(
    "Save data update event fired on relay activation",
    async (subtest) => {
      peerA.pd.once(C.EVENT.SAVE_DATA_UPDATE, (data) => {
        subtest.is(data.relay, true, "Relay mode active");
      });
      await peerA.pd.activateRelay();
    }
  );

  await t.test(
    "Save data update event fired on relay deactivation",
    async (subtest) => {
      peerA.pd.once(C.EVENT.SAVE_DATA_UPDATE, (data) => {
        subtest.is(data.relay, false, "Relay mode inactive");
      });
      await peerA.pd.deactivateRelay();
    }
  );
});

////////////////////////////////////////////////////////////////////////////////
// Network communication tests
////////////////////////////////////////////////////////////////////////////////

test("PearDrive: Custom message", async (t) => {
  const { bootstrap } = await createTestnet();

  const [peerA, peerB] = await utils.createNetwork({
    baseName: "custom-message",
    bootstrap,
    n: 2,
    onError: (err) => t.fail("onError called", err),
    indexOpts: {
      disablePolling: true, // Disable polling for this test
      pollInterval: 500,
    },
  });

  t.teardown(async () => {
    await peerA.pd.close();
    await peerB.pd.close();
  });

  const CUSTOM_MESSAGE = "custom_message";
  let customMessageReceived = 0;

  const CUSTOM_ONCE_MESSAGE = "custom_once_message";
  let customOnceMessageReceived = 0;

  await t.test("Send custom message to peer", async (subtest) => {
    peerB.pd.listen(CUSTOM_MESSAGE, (_payload) => {
      customMessageReceived += 1;
      return "test";
    });

    const peerId = peerA.pd.listPeers()[0].publicKey;
    const response = await peerA.pd.sendMessage(peerId, CUSTOM_MESSAGE, {
      data: "test",
    });
    subtest.is(
      customMessageReceived,
      1,
      "Custom message received by pearDriveB"
    );
    subtest.is(
      response.status,
      C.MESSAGE_STATUS.SUCCESS,
      "Custom message response received by pearDriveA successfully"
    );
    subtest.is(
      response.data,
      "test",
      "Custom message response data is correct"
    );
  });

  await t.test("Unlisten custom message", async (subtest) => {
    peerB.pd.unlisten(CUSTOM_MESSAGE);

    const peerId = peerA.pd.listPeers()[0].publicKey;
    const response = await peerA.pd.sendMessage(peerId, CUSTOM_MESSAGE, {
      data: "test",
    });
    subtest.is(
      customMessageReceived,
      1,
      "Custom message not received by pearDriveB after unlisten"
    );
    subtest.is(
      response.status,
      C.MESSAGE_STATUS.UNKNOWN_MESSAGE_TYPE,
      "Custom message response status is UNKNOWN_MESSAGE_TYPE after unlisten"
    );
  });

  await t.test("Send once custom message to peer", async (subtest) => {
    let customOnceRequestReceived = 0;
    peerB.pd.listenOnce(CUSTOM_ONCE_MESSAGE, (_payload) => {
      customOnceRequestReceived += 1;
    });

    const peerId = peerA.pd.listPeers()[0].publicKey;
    const response = await peerA.pd.sendMessage(peerId, CUSTOM_ONCE_MESSAGE, {
      data: "test",
    });
    const response2 = await peerA.pd.sendMessage(peerId, CUSTOM_ONCE_MESSAGE, {
      data: "test",
    });

    subtest.is(
      response.status,
      C.MESSAGE_STATUS.SUCCESS,
      "First send succeeded"
    );
    subtest.is(
      response2.status,
      C.MESSAGE_STATUS.UNKNOWN_MESSAGE_TYPE,
      "Second send failed"
    );
    subtest.is(customOnceRequestReceived, 1, "Once listener fired once");
  });
});

////////////////////////////////////////////////////////////////////////////////
// File viewing tests
////////////////////////////////////////////////////////////////////////////////

test("PearDrive: List local files", async (t) => {
  const { bootstrap } = await createTestnet();

  const { pd, watchPath } = await utils.createPearDrive({
    name: "list-local-files",
    bootstrap,
    onError: (err) => t.fail("onError called", err),
    indexOpts: { disablePolling: true, pollInterval: 500 },
  });
  t.teardown(() => pd.close());
  await pd.ready();

  // Create some files
  const files = [];
  for (let i = 0; i < 5; i++) {
    files.push(utils.createRandomFile(watchPath, 10));
  }
  await pd._syncLocalFilesOnce();

  // List local files
  const localFiles = await pd.listLocalFiles();
  t.is(localFiles.length, files.length, "Listed correct number of local files");
  for (const file of files) {
    t.ok(
      localFiles.some((f) => f.path === file.name),
      `File ${file.name} is listed`
    );
  }
});

test("PearDrive: List network files", async (t) => {
  const { bootstrap } = await createTestnet();

  const [pearDriveA, pearDriveB] = await utils.createNetwork({
    baseName: "list-network-files",
    bootstrap,
    n: 2,
    onError: (err) => t.fail("onError called", err),
    indexOpts: {
      disablePolling: true, // Disable polling for this test
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
  await pearDriveA.pd._syncLocalFilesOnce();

  // Create files on pearDriveB
  const filesB = [];
  for (let i = 0; i < 3; i++) {
    filesB.push(utils.createRandomFile(pearDriveB.pd.watchPath, 10));
  }
  await pearDriveB.pd._syncLocalFilesOnce();

  await utils.wait(1); // Give replication a moment to propagate

  // Test file indexing on pearDriveB
  const pearDriveAkey = pearDriveA.pd.publicKey;
  const networkFilesB = await pearDriveB.pd.listNetworkFiles();

  t.is(
    networkFilesB.get("local").length,
    filesB.length,
    "Listed correct number of local network files"
  );
  t.is(
    networkFilesB.get(pearDriveAkey).length,
    filesA.length,
    "Listed correct number of remote network files"
  );
  for (const file of networkFilesB.get("local")) {
    t.ok(
      filesB.some((f) => f.name === file.path),
      `File ${file.path} is listed in local network files`
    );
  }
  for (const file of networkFilesB.get(pearDriveAkey)) {
    t.ok(
      filesA.some((f) => f.name === file.path),
      `File ${file.path} is listed in remote network files`
    );
  }

  // Test file indexing on pearDriveA
  const pearDriveBkey = pearDriveB.pd.publicKey;
  const networkFilesA = await pearDriveA.pd.listNetworkFiles();
  t.is(
    networkFilesA.get("local").length,
    filesA.length,
    "Listed correct number of local network files"
  );
  t.is(
    networkFilesA.get(pearDriveBkey).length,
    filesB.length,
    "Listed correct number of remote network files"
  );
  for (const file of networkFilesA.get("local")) {
    t.ok(
      filesA.some((f) => f.name === file.path),
      `File ${file.path} is listed in local network files`
    );
  }
  for (const file of networkFilesA.get(pearDriveBkey)) {
    t.ok(
      filesB.some((f) => f.name === file.path),
      `File ${file.path} is listed in remote network files`
    );
  }
});

test("PearDrive: Test single file download", async (t) => {
  const { bootstrap } = await createTestnet();

  const [peerA, peerB] = await utils.createNetwork({
    baseName: "file-download-test",
    bootstrap,
    n: 2,
    onError: (err) => t.fail("onError called", err),
    indexOpts: {
      disablePolling: true, // Disable polling for this test
      pollInterval: 500,
    },
  });
  t.teardown(async () => {
    await peerA.pd.close();
    await peerB.pd.close();
  });

  // Create a file on pearDriveA
  const fileA = utils.createRandomFile(peerA.pd.watchPath, 10);
  await peerA.pd._syncLocalFilesOnce();
  await peerB.pd._syncLocalFilesOnce();

  // Get hash of the filefrom peerA
  const files = await peerA.pd.listLocalFiles();
  const fileEntry = files.find((f) => f.path === fileA.name);
  const fileHash = fileEntry.hash;

  // Download the file from pearDriveB
  await peerB.pd.downloadFileFromPeer(peerA.pd.publicKey, fileA.name);
  await peerB.pd._syncLocalFilesOnce();

  // Ensure the file was downloaded correctly
  const peerBLocalFiles = await peerB.pd.listLocalFiles();
  const downloadedFile = peerBLocalFiles.find((f) => f.path === fileA.name);
  const downloadedFileHash = downloadedFile.hash;

  t.is(downloadedFileHash, fileHash, "Downloaded file hash matches original");
});

test("PearDrive: Download five files", async (t) => {
  const { bootstrap } = await createTestnet();

  const [peerA, peerB] = await utils.createNetwork({
    baseName: "file-download-five-test",
    bootstrap,
    n: 2,
    onError: (err) => t.fail("onError called", err),
    indexOpts: {
      disablePolling: true, // Disable polling for this test
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
  await peerA.pd._syncLocalFilesOnce();

  // Get file hashes from peerA
  const peerAFiles = await peerA.pd.listLocalFiles();
  const fileAHashes = peerAFiles.map((f) => ({
    name: f.path,
    hash: f.hash,
  }));

  // Download all files from perA to peerB
  for (const file of filesA) {
    await peerB.pd.downloadFileFromPeer(peerA.pd.publicKey, file.name);
    await peerB.pd._syncLocalFilesOnce();
  }

  // Ensure all files were downloaded correctly
  const peerBLocalFiles = await peerB.pd.listLocalFiles();
  const fileBHashes = peerBLocalFiles.map((f) => ({
    name: f.path,
    hash: f.hash,
  }));

  t.is(peerBLocalFiles.length, filesA.length, "All files downloaded to peerB");
  for (const file of fileAHashes) {
    const downloadedFile = fileBHashes.find((f) => f.name === file.name);
    t.ok(downloadedFile, `File ${file.name} was downloaded`);
    t.is(
      downloadedFile.hash,
      file.hash,
      `Hash for ${file.name} matches original`
    );
  }
});

test(
  "PearDrive: Test nested file download preserves relative path",
  { stealth: true },
  async (t) => {
    const { bootstrap } = await createTestnet();

    const [peerA, peerB] = await utils.createNetwork({
      baseName: "nested-file-download-test",
      bootstrap,
      n: 2,
      onError: (err) => t.fail("onError called", err),
      indexOpts: {
        disablePolling: true,
        pollInterval: 500,
      },
    });
    t.teardown(async () => {
      await peerA.pd.close();
      await peerB.pd.close();
    });

    // Create file in nested folder on peer A
    const relNestedPath = path.join("nested", "folder");
    const nestedDirA = path.join(peerA.pd.watchPath, "nested", "folder");
    fs.mkdirSync(nestedDirA, { recursive: true });
    const fileA = utils.createRandomFile(nestedDirA, 20);
    const relFilePath = path.relative(peerA.pd.watchPath, fileA.path);

    // Sync both peers' local indexes
    await peerA.pd._syncLocalFilesOnce();
    await peerB.pd._syncLocalFilesOnce();

    // Get original hash from peer A
    const filesA = await peerA.pd.listLocalFiles();
    const fileEntryA = filesA.find((f) => f.path === relFilePath);
    t.ok(fileEntryA, "Peer A indexed nested file");
    const originalHash = fileEntryA.hash;

    // Download the nested file from peer A to peer B
    await peerB.pd.downloadFileFromPeer(peerA.pd.publicKey, relFilePath);
    await peerB.pd._syncLocalFilesOnce();

    // Ensure downloaded file exists in the correct nested path on peer B
    const filesB = await peerB.pd.listLocalFiles();
    const downloaded = filesB.find((f) => f.path === relFilePath);
    const nestedDirB = path.join(peerB.pd.watchPath, relNestedPath);
    const absNestedFileB = path.join(nestedDirB, fileA.name);
    t.ok(downloaded, "Peer B indexed the downloaded nested file");
    t.ok(
      fs.existsSync(nestedDirB),
      "Peer B created nested directory structure"
    );
    t.ok(
      fs.existsSync(absNestedFileB),
      "Peer B wrote the file into nested path"
    );

    t.is(
      downloaded.hash,
      originalHash,
      "Downloaded nested file hash matches original"
    );
  }
);

test("PearDrive: File relaying", async (t) => {
  const { bootstrap } = await createTestnet();

  const [peerA, peerB] = await utils.createNetwork({
    baseName: "file-download-relay-test",
    bootstrap,
    n: 2,
    onError: (err) => t.fail(`onError called`, err),
    indexOpts: {
      disablePolling: true, // Disable polling for this test
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

  await t.test("New file downloading with relay", async (subtest) => {
    const success = await utils.waitFor(
      async () => {
        let isTrue = false;
        const localFiles = await peerB.pd.listLocalFiles();

        if (localFiles.length < 2) return false;
        isTrue = localFiles.some((f) => f.path === fileA1.name);
        isTrue = isTrue && localFiles.some((f) => f.path === fileA2.name);

        return isTrue;
      },
      15000,
      100
    );

    subtest.ok(success, "Files downloaded successfully with relay");
  });

  await t.test("File update syncing with relay", async (subtest) => {
    // This won't be implemented until 3.0.0 file ID system
    skip();

    // Update fileA and ensure it syncs
    const oldFileAhash = (await peerA.pd.listLocalFiles()).find(
      (f) => f.path === fileA1.name
    ).hash;
    const fileA1v2 = { ...fileA1, content: "modified content 1" };
    fs.writeFileSync(
      path.join(peerA.pd.watchPath, fileA1.name),
      fileA1v2.content
    );
    await peerA.pd._syncLocalFilesOnce();
    const newFileAhash = (await peerA.pd.listLocalFiles()).find(
      (f) => f.path === fileA1v2.name
    ).hash;
    await peerB.pd._syncLocalFilesOnce();
    const fileSynced = await utils.waitFor(
      async () => {
        const localFiles = await peerB.pd.listLocalFiles();
        return localFiles.some(
          (f) => f.path === fileA1.name && f.hash === newFileAhash
        );
      },
      15000,
      100
    );

    subtest.ok(fileSynced, "File updated and synced successfully with relay");
  });
});
