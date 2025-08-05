import test from "brittle";
import Corestore from "corestore";
import fs from "fs";
import path from "path";

import LocalFileIndex from "../src/LocalFileIndex.js";
import Logger from "../src/Logger.js";
import * as utils from "./lib/utils.js";
import * as Ctest from "./lib/constants.js";

////////////////////////////////////////////////////////////////////////////////
// Test cases for LocalFileIndex
////////////////////////////////////////////////////////////////////////////////

test("LocalFileIndex: buildIndex creates entries in Hyperbee", async (t) => {
  utils.clearTestData();
  utils.createTestFolders();

  // Set up indexer
  const { indexer, localDrivePath } = await utils.makeLocalFileIndex(
    "test-index"
  );
  for (let i = 0; i < 3; i++) {
    utils.createRandomFile(localDrivePath, 10);
  }

  await indexer.ready();
  await indexer.buildIndex();

  const results = [];
  for await (const { key, value } of indexer.getBee().createReadStream()) {
    results.push({ key, value });
  }

  t.ok(results.length >= 3, "should index at least 3 files");
  for (const entry of results) {
    t.ok(entry.value.hash, "file has hash");
    t.ok(entry.value.size > 0, "file has size");
  }
});

test("LocalFileIndex: polling detects new file", async (t) => {
  utils.clearTestData();
  utils.createTestFolders();

  const { indexer, localDrivePath } = await utils.makeLocalFileIndex(
    "poll-test"
  );

  // Add initial 5 files
  for (let i = 0; i < 5; i++) {
    utils.createRandomFile(localDrivePath, 10);
  }

  await indexer.ready();
  await indexer.buildIndex();

  // Confirm initial file count
  const initialEntries = [];
  for await (const entry of indexer.getBee().createReadStream()) {
    initialEntries.push(entry);
  }
  t.is(initialEntries.length, 5, "5 initial files indexed");

  // Start polling
  indexer.startPolling(100);

  // Add a new file after polling starts
  utils.createRandomFile(localDrivePath, 10);

  // Wait enough time for polling to pick up new file
  await utils.wait(1);

  // Check for new entry
  const afterPollEntries = [];
  for await (const entry of indexer.getBee().createReadStream()) {
    afterPollEntries.push(entry);
  }

  t.is(afterPollEntries.length, 6, "should index new file via polling");
  indexer.stopPolling();
});
