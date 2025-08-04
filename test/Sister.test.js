import test, { solo } from "brittle";
import fs from "fs";
import path from "path";
import createTestnet from "hyperdht/testnet.js";

import * as C from "../src/constants.js";
import * as utils from "./lib/utils.js";
const { txt } = utils;

////////////////////////////////////////////////////////////////////////////////
// Test utilities
////////////////////////////////////////////////////////////////////////////////

////////////////////////////////////////////////////////////////////////////////
// Sister core functionality tests
////////////////////////////////////////////////////////////////////////////////

test(txt.main("Initialization and saveData"), async (t) => {
  const testnet = await createTestnet();
  const { bootstrap } = testnet;

  utils.clearTestData();
  utils.createTestFolders();

  const { pd, localDrivePath, corestorePath, logPath } =
    await utils.createSister("init-test", bootstrap, () =>
      t.fail("onError called")
    );
  t.teardown(() => {
    pd.close();
  });

  await pd.ready();
  t.pass(txt.pass("ready() completed"));

  const data = pd.getSaveData();
  t.is(data.watchPath, localDrivePath, txt.pass("watchPath saved"));
  t.is(data.corestorePath, corestorePath, txt.pass("corestorePath saved"));
  t.is(data.logOpts.logFilePath, logPath, txt.pass("logFilePath saved"));
});

////////////////////////////////////////////////////////////////////////////////
// Network connectivity tests
////////////////////////////////////////////////////////////////////////////////

test(txt.main("Join single-node sisterhood"), async (t) => {
  const testnet = await createTestnet();
  const { bootstrap } = testnet;

  utils.clearTestData();
  utils.createTestFolders();

  const { pd } = await utils.createSister("net1", bootstrap);
  t.teardown(() => {
    pd.close();
  });
  await pd.ready();
  await pd.joinNetwork();

  t.ok(pd.connected, "connected flag set");
  const peers = pd.listPeers();
  t.is(peers.length, 0, "no other peers present");
});

test("Connect two peers", async (t) => {
  const testnet = await createTestnet();
  const { bootstrap } = testnet;

  utils.clearTestData();
  utils.createTestFolders();

  const [p1, p2] = await utils.createSisterhood("net-peer", bootstrap, 2);
  t.teardown(() => {
    p1.pd.close();
    p2.pd.close();
  });
  await utils.wait(1);
  t.ok(p1.pd.connected && p2.pd.connected, txt.pass("both peers connected"));

  const peers1 = p1.pd.listPeers();
  const peers2 = p2.pd.listPeers();
  t.is(peers1.length, 1, txt.pass("p1 sees 1 peer"));
  t.is(peers2.length, 1, txt.pass("p2 sees 1 peer"));
});

test(txt.main("Connect five peers"), async (t) => {
  const testnet = await createTestnet();
  const { bootstrap } = testnet;

  utils.clearTestData();
  utils.createTestFolders();

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
    t.ok(pd.connected, txt.pass("peer is connected"));
  }

  // Each peer should see 4 other peers
  for (const pd of pds) {
    const peers = pd.listPeers();
    t.is(peers.length, 4, txt.pass("peer sees 4 other peers"));
  }
});

////////////////////////////////////////////////////////////////////////////////
// Sister Event Emitter tests
////////////////////////////////////////////////////////////////////////////////

test(txt.main("NETWORK event on connect when files exist"), async (t) => {
  // clear & recreate mock folders
  utils.clearTestData();
  utils.createTestFolders();

  const testnet = await createTestnet();
  const { bootstrap } = testnet;

  // Create two Sister instances but don't join yet
  const pd1 = await utils.createSister("net-event-1", bootstrap, () => {
    t.fail("onError called");
  });
  const pd2 = await utils.createSister("net-event-2", bootstrap, () => {
    t.fail("onError called");
  });

  t.teardown(async () => {
    await pd1.pd.close();
    await pd2.pd.close();
  });

  // Initialize both
  await pd1.pd.ready();
  await pd2.pd.ready();

  // Track NETWORK events
  let fired1 = false;
  let fired2 = false;
  pd1.pd.on(C.EVENT.NETWORK, () => {
    fired1 = true;
  });
  pd2.pd.on(C.EVENT.NETWORK, () => {
    fired2 = true;
  });

  // Create a file in pd1's local drive
  const filePath = path.join(pd1.localDrivePath, "test-file.txt");
  fs.writeFileSync(filePath, "Heyyy sister!");
  // Create a file in pd2' local drive
  const filePath2 = path.join(pd2.localDrivePath, "test-file2.txt");
  fs.writeFileSync(filePath2, "Purr!");

  // Now join the swarm
  await pd1.pd.joinNetwork();
  await pd2.pd.joinNetwork(pd1.pd.networkKey);

  // Give it a moment to handshake & fire events
  await utils.wait(3);

  if (!fired1 || !fired2) {
    t.fail("NETWORK event not fired on peer connect");
    return;
  }

  t.pass(txt.pass("NETWORK event fired on peer connect"));
});

test(txt.main("PEER event on sister connect"), async (t) => {
  const testnet = await createTestnet();
  const { bootstrap } = testnet;

  utils.clearTestData();
  utils.createTestFolders();

  // Create two sisters, but only bring up the first
  const sisterA = await utils.createSister("sisterA", bootstrap);
  const sisterB = await utils.createSister("sisterB", bootstrap);
  t.teardown(async () => {
    await sisterA.pd.close();
    await sisterB.pd.close();
  });

  await sisterA.pd.ready();
  await sisterB.pd.ready();

  // Listen for PEER event on A
  let connectFired = false;
  sisterA.pd.on(C.EVENT.PEER, () => {
    connectFired = true;
  });

  // Now join B into A’s network
  await sisterA.pd.joinNetwork();
  await sisterB.pd.joinNetwork(sisterA.pd.networkKey);
  await utils.wait(1);

  if (connectFired) {
    t.pass(txt.pass("PEER event fired on sister connect"));
  } else {
    t.fail(txt.fail("PEER event did *not* fire on sister connect"));
  }
});

test(txt.main("PEER event on sister disconnect"), async (t) => {
  const testnet = await createTestnet();
  const { bootstrap } = testnet;

  utils.clearTestData();
  utils.createTestFolders();

  // Spin up two sisters in the same sisterhood
  const [p1, p2] = await utils.createSisterhood("peerDisc", bootstrap, 2);
  t.teardown(async () => {
    await p1.pd.close();
    await p2.pd.close();
  });

  // Listen for PEER on p1
  let disconnectFired = false;
  p1.pd.on(C.EVENT.PEER, (peerId) => {
    // after shutdown, p1.listPeers() will no longer include p2
    if (!p1.pd.listPeers().find((p) => p.publicKey === peerId)) {
      disconnectFired = true;
    }
  });

  // Give them a moment to connect
  await utils.wait(1);

  // Now tear down p2
  await p2.pd.close();
  await utils.wait(1);

  if (disconnectFired) {
    t.pass(txt.pass("PEER event fired on sister disconnect"));
  } else {
    t.fail(txt.fail("PEER event did *not* fire on sister disconnect"));
  }
});

test(txt.main("LOCAL event on file addition"), async (t) => {
  const testnet = await createTestnet();
  const { bootstrap } = testnet;

  utils.clearTestData();
  utils.createTestFolders();

  const { pd, localDrivePath } = await utils.createSister(
    "local-add",
    bootstrap,
    (err) => t.fail(txt.fail("onError called"), err)
  );
  t.teardown(() => pd.close());
  await pd.ready();

  let fired = false;
  pd.on(C.EVENT.LOCAL, () => {
    fired = true;
  });

  // create a new file
  utils.createRandomFile(localDrivePath);
  await utils.wait(1);

  t.ok(fired, txt.pass("LOCAL event fired on file addition"));
});

test(txt.main("LOCAL event on file deletion"), async (t) => {
  const testnet = await createTestnet();
  const { bootstrap } = testnet;

  utils.clearTestData();
  utils.createTestFolders();

  // create a file before starting
  const name = "local-delete";
  const { pd, localDrivePath } = await utils.createSister(
    name,
    bootstrap,
    (err) => t.fail(txt.fail("onError called"), err)
  );
  // make an initial file
  const filePath = path.join(localDrivePath, "to-delete.txt");
  fs.writeFileSync(filePath, "delete me");

  t.teardown(() => pd.close());
  await pd.ready();

  let fired = false;
  pd.on(C.EVENT.LOCAL, () => {
    fired = true;
  });

  // remove the file
  fs.unlinkSync(filePath);
  await utils.wait(2);

  t.ok(fired, txt.pass("LOCAL event fired on file deletion"));
});

test(txt.main("LOCAL event on file modification"), async (t) => {
  const testnet = await createTestnet();
  const { bootstrap } = testnet;

  utils.clearTestData();
  utils.createTestFolders();

  // create a file before starting
  const name = "local-modify";
  const { pd, localDrivePath } = await utils.createSister(
    name,
    bootstrap,
    (err) => t.fail(txt.fail("onError called"), err)
  );
  const filePath = path.join(localDrivePath, "to-modify.txt");
  fs.writeFileSync(filePath, "original content");

  t.teardown(() => pd.close());
  await pd.ready();

  let fired = false;
  pd.on(C.EVENT.LOCAL, () => {
    fired = true;
  });

  // modify the file
  fs.writeFileSync(filePath, "new content");
  await utils.wait(1);

  t.ok(fired, txt.pass("LOCAL event fired on file modification"));
});

test(
  txt.main("Event hooks: GENERAL is emitted alongside built-ins"),
  async (t) => {
    const { bootstrap } = await createTestnet();

    utils.clearTestData();
    utils.createTestFolders();

    // LOCAL
    await t.test(txt.sub("GENERAL alongside LOCAL"), async (t) => {
      const { pd, localDrivePath } = await utils.createSister(
        "event-local-",
        bootstrap
      );
      t.teardown(() => pd.close());
      await pd.ready();
      await pd.joinNetwork();

      let sawLocal = false;
      let sawGeneral = false;
      pd.on(C.EVENT.LOCAL, () => {
        sawLocal = true;
      });
      pd.on(C.EVENT.GENERAL, () => {
        sawGeneral = true;
      });

      // trigger a local file change
      utils.createRandomFile(localDrivePath);
      await utils.wait(1);

      t.ok(sawLocal, txt.pass("LOCAL hook fired"));
      t.ok(sawGeneral, txt.pass("GENERAL also fired on LOCAL"));
    });

    // PEER
    await t.test(txt.sub("GENERAL alongside PEER"), async (t) => {
      const peers = await utils.createSisterhood("event-peer-", bootstrap, 2);
      const [p1, p2] = peers;
      t.teardown(() => {
        p1.pd.close();
        p2.pd.close();
      });

      let sawPeer = false;
      let sawGeneral = false;
      p1.pd.on(C.EVENT.PEER, () => {
        sawPeer = true;
      });
      p1.pd.on(C.EVENT.GENERAL, () => {
        sawGeneral = true;
      });

      // give them a moment to handshake
      await utils.wait(1);

      t.ok(sawPeer, txt.pass("PEER hook fired on p1"));
      t.ok(sawGeneral, txt.pass("GENERAL also fired on PEER"));
    });

    // NETWORK
    await t.test(txt.sub("GENERAL alongside NETWORK"), async (t) => {
      // both peers have index data already, so joining should emit NETWORK
      const peers = await utils.createSisterhood("event-net-", bootstrap, 2);
      const [p1, p2] = peers;
      t.teardown(() => {
        p1.pd.close();
        p2.pd.close();
      });

      let sawNetwork = false;
      let sawGeneral = false;
      p1.pd.on(C.EVENT.NETWORK, () => {
        sawNetwork = true;
      });
      p1.pd.on(C.EVENT.GENERAL, () => {
        sawGeneral = true;
      });

      // wait for the index exchange to complete
      await utils.wait(1);

      t.ok(sawNetwork, txt.pass("NETWORK hook fired on p1"));
      t.ok(sawGeneral, txt.pass("GENERAL also fired on NETWORK"));
    });
  }
);
