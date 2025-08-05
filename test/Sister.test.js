import test, { solo } from "brittle";
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
// Sister core functionality tests
////////////////////////////////////////////////////////////////////////////////

test(txt.main("Initialization and saveData"), async (t) => {
  const testnet = await createTestnet();
  const { bootstrap } = testnet;

  const { pd, localDrivePath, corestorePath, logPath } =
    await utils.createSister("init-test", bootstrap, () =>
      t.fail("onError called")
    );
  t.teardown(() => {
    pd.close();
  });

  await pd.ready();
  t.pass("ready() completed");

  const data = pd.getSaveData();
  t.is(data.watchPath, localDrivePath, "watchPath saved");
  t.is(data.corestorePath, corestorePath, "corestorePath saved");
  t.is(data.logOpts.logFilePath, logPath, "logFilePath saved");
});

////////////////////////////////////////////////////////////////////////////////
// Network connectivity tests
////////////////////////////////////////////////////////////////////////////////

test(txt.main("Join single-node sisterhood"), async (t) => {
  const testnet = await createTestnet();
  const { bootstrap } = testnet;

  const { pd } = await utils.createSister("net1", bootstrap);
  t.teardown(() => {
    pd.close();
  });
  await pd.ready();
  await pd.joinNetwork();

  t.ok(pd.connected, "Sister connected to network");
});

test("Connect two peers", async (t) => {
  const testnet = await createTestnet();
  const { bootstrap } = testnet;

  const [p1, p2] = await utils.createSisterhood("net-peer", bootstrap, 2);
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
});

test(txt.main("Connect five peers"), async (t) => {
  const testnet = await createTestnet();
  const { bootstrap } = testnet;

  // Spin up 5 peers
  const peerObjs = await utils.createSisterhood("peer", bootstrap, 5);
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
});

////////////////////////////////////////////////////////////////////////////////
// Sister Event Emitter tests
////////////////////////////////////////////////////////////////////////////////

test(txt.main("NETWORK events"), async (t) => {
  const testnet = await createTestnet();
  const { bootstrap } = testnet;

  const [sisterA, sisterB] = await utils.createSisterhood(
    "network-events",
    bootstrap,
    2
  );
  t.teardown(async () => {
    sisterA.pd.close();
    sisterB.pd.close();
  });

  let networkAFired = false;
  let systemAFired = false;
  let networkBFired = false;
  let systemBFired = false;
  sisterA.pd.on(C.EVENT.NETWORK, () => {
    networkAFired = true;
  });
  sisterA.pd.on(C.EVENT.SYSTEM, () => {
    systemAFired = true;
  });
  sisterB.pd.on(C.EVENT.NETWORK, () => {
    networkBFired = true;
  });
  sisterB.pd.on(C.EVENT.SYSTEM, () => {
    systemBFired = true;
  });

  //
  // Test NETWORK event on file addition
  //

  utils.createRandomFile(sisterA.localDrivePath);
  await sisterA.pd.syncLocalFilesOnce();
  await utils.wait(1);

  t.ok(networkBFired, "NETWORK event fired on sisterB after file addition");
  t.ok(systemBFired, "SYSTEM event fired on sisterB after file addition");

  //
  // Test NETWORK event on file modification
  //

  networkBFired = false;
  systemBFired = false;

  const modifiedContent = "modified content";
  const filePath = path.join(sisterA.localDrivePath, "to-modify.txt");
  fs.writeFileSync(filePath, modifiedContent);
  await sisterA.pd.syncLocalFilesOnce();
  await utils.wait(1);

  t.ok(networkBFired, "NETWORK event fired on sisterB after file modification");
  t.ok(systemBFired, "SYSTEM event fired on sisterB after file modification");

  //
  // Test NETWORK event on file deletion
  //

  networkBFired = false;
  systemBFired = false;

  fs.unlinkSync(filePath);
  await sisterA.pd.syncLocalFilesOnce();
  await utils.wait(1);

  t.ok(networkBFired, "NETWORK event fired on sisterB after file deletion");
  t.ok(systemBFired, "SYSTEM event fired on sisterB after file deletion");
});

test(txt.main("PEER events"), async (t) => {
  const testnet = await createTestnet();
  const { bootstrap } = testnet;

  const sisterA = await utils.createSister("sisterA", bootstrap);
  const sisterB = await utils.createSister("sisterB", bootstrap);
  t.teardown(async () => {
    await sisterA.pd.close();
    await sisterB.pd.close();
  });
  await sisterA.pd.ready();
  await sisterB.pd.ready();

  let peerAFired = false;
  let systemAFired = false;
  let peerBFired = false;
  let systemBFired = false;
  sisterA.pd.on(C.EVENT.PEER, () => {
    peerAFired = true;
  });
  sisterA.pd.on(C.EVENT.SYSTEM, () => {
    systemAFired = true;
  });
  sisterB.pd.on(C.EVENT.PEER, () => {
    peerBFired = true;
  });
  sisterB.pd.on(C.EVENT.SYSTEM, () => {
    systemBFired = true;
  });

  //
  // Test PEER event on connect
  //
  await sisterA.pd.joinNetwork();
  await sisterB.pd.joinNetwork(sisterA.pd.networkKey);
  await utils.awaitAllConnected([sisterA.pd, sisterB.pd]);

  t.ok(peerAFired, "PEER event fired on sisterA");
  t.ok(systemAFired, "SYSTEM event fired on sisterA");
  t.ok(peerBFired, "PEER event fired on sisterB");
  t.ok(systemBFired, "SYSTEM event fired on sisterB");

  //
  // Test PEER event on disconnect
  //
  // Only look at peer A, because B will be removed from A's peer list
  peerAFired = false;
  systemAFired = false;
  await sisterB.pd.close();
  await utils.wait(1);
  t.ok(peerAFired, "PEER event fired on sisterA after sisterB disconnects");
  t.ok(systemAFired, "SYSTEM event fired on sisterA after sisterB disconnects");
});

test(txt.main("LOCAL events"), async (t) => {
  const testnet = await createTestnet();
  const { bootstrap } = testnet;

  const { pd, localDrivePath } = await utils.createSister(
    "local-events",
    bootstrap,
    (err) => t.fail(txt.fail("onError called"), err),
    { poll: false, pollInterval: 500 }
  );
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
