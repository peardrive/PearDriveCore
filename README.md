# Sister.js (alpha)

> A simple node.js p2p communication system for messaging and file transfer

---

## ✨ Features

- 🔁 p2p messaging across secret networks
- 🔁 p2p file sharing
- 🪵 Extensive logging system with the option to log to a given file
- ⚙️ Node.js and bare runtime compatible for React Native, Pear runtime and
  standard Node.js environments
- ⚙️ TypeScript compatible

---

## 📦 Installation

> This is just a simple (to use) npm module. So install it into your project
> using npm.

```bash
npm install @hopets/sisterjs
```

---

## 🔨 Tutorial / Examples

### Creating a Sister (Sister.js instance)

```javascript
import Sister, { EVENT, purse } from "@hopets/sisterjs";
import path from "path";
import fs from "fs";

async function main() {
  // Choose where Sister stores its data and what folder to watch for files
  const corestorePath = path.resolve(".sister/corestore-A");
  const watchPath = path.resolve(".sister/files-A");
  await fs.mkdir(corestorePath, { recursive: true });
  await fs.mkdir(watchPath, { recursive: true });

  // Create the instance
  const sister = new Sister({
    corestorePath,
    watchPath,
    logOpts: { logToConsole: true },
    indexOpts: { poll: true, pollInterval: 500 },
  });

  await sister.ready();

  // Join (or create) a network. If you pass a hex string/Buffer,
  // multiple Sisters can meet on the same “topic”.
  // Here we generate one and print it so another process can reuse it.
  const networkKey = purse.generateSeed(); // Uint8Array
  await sister.joinNetwork(networkKey);

  console.log("Your public key:", sister.publicKeyStr);
  console.log(
    "Share this network key so other peers can join:",
    purse.formatToStr(networkKey)
  );

  // Basic events
  sister.on(EVENT.PEER, (peerId) => console.log("Peer event:", peerId));
  sister.on(EVENT.NETWORK, () => console.log("Network file index changed"));
  sister.on(EVENT.LOCAL, () => console.log("Local file index changed"));
  sister.on(EVENT.ERROR, (err) => console.error("Sister ERROR:", err));

  // Optional: seed a test file
  await fs.writeFile(path.join(watchPath, "hello.txt"), "hi from A\n");

  // List local files
  const local = await sister.listLocalFiles();
  console.log("Local index key:", purse.formatToStr(local.key));
  console.log("Local files:", local.files);
}

// It runs until the process is killed
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

### Creating a Sisterhood (Connecting sister.js peers, creating a network)

```javascript
const NETWORK_KEY = purse.formatToStr(purse.generateSeed());

async function mainA() {
  const corestorePath = path.resolve(".sister/corestore-A");
  const watchPath = path.resolve(".sister/files-A");
  await fs.mkdir(corestorePath, { recursive: true });
  await fs.mkdir(watchPath, { recursive: true });

  const sisterA = new Sister({
    networkKey: NETWORK_KEY,
    corestorePath,
    watchPath,
  });
  await sisterA.ready();

  await sisterA.joinNetwork();

  console.log("A pubkey:", sisterA.publicKeyStr);
  console.log("NETWORK_KEY (give to Peer B):", purse.formatToStr(networkKey));

  sisterA.on(EVENT.PEER, (peerId) => console.log("[A] Peer:", peerId));
  sisterA.on(EVENT.ERROR, console.error);

  // Put a file in A's watch dir
  await fs.writeFile(path.join(watchPath, "from-A.txt"), "hello from A\n");
}

mainA().catch(console.error);

async function main() {
  const corestorePath = path.resolve(".sister/corestore-B");
  const watchPath = path.resolve(".sister/files-B");
  await fs.mkdir(corestorePath, { recursive: true });
  await fs.mkdir(watchPath, { recursive: true });

  const sisterB = new Sister({
    networkKey: NETWORK_KEY,
    corestorePath,
    watchPath,
  });
  await sisterB.ready();

  await sisterB.joinNetwork();

  console.log("B pubkey:", sisterB.publicKeyStr);

  sisterB.on(EVENT.PEER, (peerId) => console.log("[B] Peer:", peerId));
  sisterB.on(EVENT.NETWORK, () => console.log("[B] network index changed"));
  sisterB.on(EVENT.ERROR, console.error);

  // Wait a moment for discovery
  setTimeout(async () => {
    // See remote files
    const nonLocal = await sisterB.listNonLocalFiles();
    console.log("[B] Non-local files (by peer):", nonLocal);
  }, 1500);
}

main().catch(console.error);
```

### Tapping into events / seeing network information

```javascript
const sister = new Sister({
  corestorePath: "./core-A",
  watchPath: "./files-A",
});
await sister.ready();
await sister.joinNetwork("...hex-network-key...");

// Events
sister.on(EVENT.PEER, (peerId) => {
  console.log("Peer connected/disconnected:", peerId);
});

sister.on(EVENT.LOCAL, () => {
  console.log("Local files updated");
});

sister.on(EVENT.NETWORK, () => {
  console.log("Network files changed");
});

sister.on(EVENT.ERROR, (err) => {
  console.error("Sister error:", err);
});

// Inspect file indices
const local = await sister.listLocalFiles();
console.log("Local index key:", local.key, "files:", local.files);

const nonLocal = await sister.listNonLocalFiles(); // Map(peerId => {key, files})
console.log("Non-local:", nonLocal);

const all = await sister.listNetworkFiles(); // Map including "local"
console.log("All network files:", all);
```

```javascript
// Viewing files

const sister = new Sister(opts);
await sister.ready();
await sister.joinNetwork();

// View the files on the current peer (with example output)
const localFiles = await sister.listLocalFiles();
localFiles = {
  key: 'dfb13b6fa4c5da126be447ad6d45e9417b217e889fb58b3094b15cc4a5f7c2bc',
  files: [
    {
      key: '0UrH6Phl7a.txt',
      path: '0UrH6Phl7a.txt',
      size: 10,
      modified: 1754585992565.9377,
      hash: '976aa3a2cb5649e68985d2b506ffd6f5754c470940ff7c69b8af037c3a3c9bf0'
    },
    {
      key: 'W36du2Ua2V.txt',
      path: 'W36du2Ua2V.txt',
      size: 10,
      modified: 1754585992565.9377,
      hash: '92b416880a5e4ef313eba798245a4dd35429cbc01def2050e37013a99600a46d'
    },
    {
      key: 'YclQ9SONhU.txt',
      path: 'YclQ9SONhU.txt',
      size: 10,
      modified: 1754585992565.9377,
      hash: '5ad6307e71b525259266d972421420ed4d19857fa8eebca4a08f8252bb71e979'
    }
  ]
}

// View the files on other peers (with example Map output)
const nonLocalFiles = await sister.listNonLocalFiles();
nonLocalFiles = {
  '82bbbb4a9d37a030ce8a049631f4f6fbf1dbc17e27d33d042963b1c07696ff57' => {
    key: /* Buffer, stringified version is the map entry key */,
    files: [
      {
        key: '0UrH6Phl7a.txt',
        path: '0UrH6Phl7a.txt',
        size: 10,
        modified: 1754585992565.9377,
        hash: '976aa3a2cb5649e68985d2b506ffd6f5754c470940ff7c69b8af037c3a3c9bf0'
      },
      {
        key: 'W36du2Ua2V.txt',
        path: 'W36du2Ua2V.txt',
        size: 10,
        modified: 1754585992565.9377,
        hash: '92b416880a5e4ef313eba798245a4dd35429cbc01def2050e37013a99600a46d'
      },
      {
        key: 'YclQ9SONhU.txt',
        path: 'YclQ9SONhU.txt',
        size: 10,
        modified: 1754585992565.9377,
        hash: '5ad6307e71b525259266d972421420ed4d19857fa8eebca4a08f8252bb71e979'
      }
    ]
  }
}

// View the files on all peers
const listNetworkFiles = await sister.listNetworkFiles();
networkFiles = {
  '82bbbb4a9d37a030ce8a049631f4f6fbf1dbc17e27d33d042963b1c07696ff57' => {
    key: /* Buffer, stringified version is the map entry key */,
    files: [
      {
        key: '0UrH6Phl7a.txt',
        path: '0UrH6Phl7a.txt',
        size: 10,
        modified: 1754585992565.9377,
        hash: '976aa3a2cb5649e68985d2b506ffd6f5754c470940ff7c69b8af037c3a3c9bf0'
      },
      {
        key: 'W36du2Ua2V.txt',
        path: 'W36du2Ua2V.txt',
        size: 10,
        modified: 1754585992565.9377,
        hash: '92b416880a5e4ef313eba798245a4dd35429cbc01def2050e37013a99600a46d'
      },
      {
        key: 'YclQ9SONhU.txt',
        path: 'YclQ9SONhU.txt',
        size: 10,
        modified: 1754585992565.9377,
        hash: '5ad6307e71b525259266d972421420ed4d19857fa8eebca4a08f8252bb71e979'
      }
    ]
  },
  'local' => {
    key: 'dfb13b6fa4c5da126be447ad6d45e9417b217e889fb58b3094b15cc4a5f7c2bc',
    files: [
      {
        key: '0UrH6Phl7a.txt',
        path: '0UrH6Phl7a.txt',
        size: 10,
        modified: 1754585992565.9377,
        hash: '976aa3a2cb5649e68985d2b506ffd6f5754c470940ff7c69b8af037c3a3c9bf0'
      },
      {
        key: 'W36du2Ua2V.txt',
        path: 'W36du2Ua2V.txt',
        size: 10,
        modified: 1754585992565.9377,
        hash: '92b416880a5e4ef313eba798245a4dd35429cbc01def2050e37013a99600a46d'
      },
      {
        key: 'YclQ9SONhU.txt',
        path: 'YclQ9SONhU.txt',
        size: 10,
        modified: 1754585992565.9377,
        hash: '5ad6307e71b525259266d972421420ed4d19857fa8eebca4a08f8252bb71e979'
      }
    ]
  }
}

```

### Messaging

```javascript
sisterB.on("custom_message", async (payload) => {
  console.log("[B] got custom_message:", payload);
  // Return anything serializable — it becomes the response
  return { ok: true, echo: payload };
});

const peers = sisterA.listPeersStringified();
const peerId = peers[0]?.publicKey;
if (!peerId) throw new Error("No peers yet");

// Send the message
const res = await sisterA.sendMessage(peerId, "custom_message", {
  ping: Date.now(),
});
console.log("[A] response:", res);
```

### p2p file storage / transfer

```javascript
// 1) Discover a peer and a file you want
const peers = sisterB.listPeersStringified();
const peerId = peers[0]?.publicKey; // choose one
if (!peerId) throw new Error("No peers discovered yet");

// For demo, list a remote peer's files
const nonLocal = await sisterB.listNonLocalFiles();
// Map: peerId => { key:<hyperbee key>, files: [
//  { path, size, modified, hash }, ...
// ] }
const [somePeerId, remoteInfo] = [...nonLocal.entries()][0] || [];
const wanted = remoteInfo?.files?.[0]?.path; // pick first file
if (!wanted) throw new Error("Remote peer has no files (yet)");

// 2) Download it. The file will be written into *this* peer's watchPath under
// the same relative path.
await sisterB.downloadFileFromPeer(somePeerId, wanted);
console.log("Downloaded", wanted, "to", sisterB.watchPath);
```

### React Native (for mobile apps)

// TODO

---

## 🚧 Changelog

### 1.0.0

- Initial release

## ❤️ Credits

- Sister.JS developed by [Jenna Baudelaire](https://github.com/HopeTS)
