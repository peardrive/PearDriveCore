# PearDrive Core

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
npm install @peardrive/core
```

---

## 🔨 Tutorial / Examples

- Tutorials for usage and all the different features can be found [here](https://github.com/HopeTS/PearDriveCore-examples/)

- PearDriveCore uses typedoc to generate documentation, you can run 'npm run build-docs' and view the up-to-date full documentation in /docs

### React Native (for mobile apps)

> PearDrive works in Bare runtime, a node.js runtime that works on mobile builds in React Native.

- You can follow [this guide](https://docs.pears.com/guides/making-a-bare-mobile-app) for a basic tutorial on working with Bare runtime to create mobile apps.

- [Hands on tutorial for creating a React Native app in Bare runtime and connecting PearDrive to the UI](https://github.com/HopeTS/bare-runtime-native-state-tutorial)

---

## 🚧 Changelog

- Update dependencies
- Remove unused test
- Update inaccurate docs
- Add typedoc to gh pages (https://peardrive.github.io/PearDriveCore)
- Toggling relay mode with activateRelay and deactivateRelay emits SAVE_DATA_UPDATE

### 2.0.3

- Fix bug preventing files from being added to the hyperbee when a watchPath is initialized for the first time when already populated with files

### 2.0.2

- Public release

### 2.0.1

- Emit save data update when activating/deactivating relay mode

### 2.0.0

- Remove activate/deactivateLocalFileSyncing (deprecated)
- Make syncLocalFilesOnce private (it's only for testing)
- Simplify listing local, nonlocal and network files by removing the 2 values, key and files, and only returning the files as an array.
- Set listPeers() to private #listPeers(), rename listPeersStringified() to listPeers()

### 1.6.0

- Update dependencies
- Add listenOnce / unlistenOnce function
- Add unlisten function
- Remove unused indexKeySend RPC method, among others
- Improve testing speed
- Add 'queuedDownloads' for automatically redownloading files when the first download attempt fails
- add SAVE_DATA_UPDATE event hook
- All LocalDrive references fixed (LocalDrive -> WatchPath)
- Fix bug causing some files to get stuck with #isBusy status
- Fix bug causing files downloaded from nested folders to download to the root watchPath folder

### 1.5.3

- Improve error handling
- All RPC messages, internal and user-created, now return the format: {status, data}
- All RPC messages, internal and user-created, no longer throw errors directly through the RPC. Instead, they return an error status code and the data payload contains the error message.

### 1.5.2

- fix PEER\_(DIS)CONNECTED events

### 1.5.1

- Update dependencies
- Fix listNetworkFiles test

### 1.5.0

- Event system rework
- Performance improvements

### 1.4.2

- Fix timeout system for downloading files through hyperblobs

### 1.4.1

- Remove unused import causing compat issues

### 1.4.0

- Send files with hyperblobs instead of hyperdrives

### 1.3.1

- Add indexOpts to saveData, add getter for indexOpts
- Update dependencies

### 1.3.0

- Refactor PearDrive, IndexManager and LocalFileIndex to inherit ReadyResource
- Implement relay mode
- Implement file watching system to prevent unnecessary file hashing
- Move getSaveData() from function to saveData, a prototype property

### 1.2.2

- Update dependencies
- Enhance automatic polling performance

### 1.2.1

- Normalize watchPath to deal with spaces in the path
- Fix 'Corestore closed' error on subsequent downloads after the first

### 1.2.0

- Fix file downloading

### 1.1.0

- publicKey: publicKeyStr -> publicKey, make buffer variable private

### 1.0.0

- Initial release
