import test from "brittle";

import * as utils from "./lib/utils/index.js";

////////////////////////////////////////////////////////////////////////////////
// Test cases for LocalFileIndex
////////////////////////////////////////////////////////////////////////////////

test(
  "LocalFileIndex: buildIndex creates entries in Hyperbee",
  { stealth: true },
  async (t) => {
    utils.clearTestData();
    utils.createTestFolders();

    // Set up indexer
    const { indexer, watchPath } = await utils.makeLocalFileIndex("test-index");
    for (let i = 0; i < 3; i++) {
      utils.createRandomFile(watchPath, 10);
    }

    await indexer.ready();
    await indexer.buildIndex();

    const results = [];
    for await (const { key, value } of indexer.bee.createReadStream()) {
      results.push({ key, value });
    }

    t.ok(results.length >= 3, "should index at least 3 files");
    for (const entry of results) {
      t.ok(entry.value.hash, "file has hash");
      t.ok(entry.value.size > 0, "file has size");
    }
  }
);

test(
  "LocalFileIndex: polling detects new file",
  { stealth: true },
  async (t) => {
    utils.clearTestData();
    utils.createTestFolders();

    const { indexer, watchPath } = await utils.makeLocalFileIndex("poll-test");

    // Add initial 5 files
    for (let i = 0; i < 5; i++) {
      utils.createRandomFile(watchPath, 10);
    }

    await indexer.ready();
    await indexer.buildIndex();

    // Confirm initial file count
    const initialEntries = [];
    for await (const entry of indexer.bee.createReadStream()) {
      initialEntries.push(entry);
    }
    t.is(initialEntries.length, 5, "5 initial files indexed");

    // Start polling
    indexer.startPolling(100);

    // Add a new file after polling starts
    utils.createRandomFile(watchPath, 10);

    // Wait enough time for polling to pick up new file
    await utils.wait(1);

    // Check for new entry
    const afterPollEntries = [];
    for await (const entry of indexer.bee.createReadStream()) {
      afterPollEntries.push(entry);
    }

    t.is(afterPollEntries.length, 6, "should index new file via polling");
    indexer.stopPolling();
  }
);
