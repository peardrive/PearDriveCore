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
