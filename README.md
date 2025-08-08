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

// TODO

### Creating a Sisterhood (Connecting sister.js peers, creating a network)

// TODO

### Tapping into events / seeing network information

// TODO

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

// TODO

### p2p file storage / transfer

// TODO

### React Native (for mobile apps)

// TODO

---

## 🚧 Changelog

### 1.0.0

- Initial release

## ❤️ Credits

- Sister.JS developed by [Jenna Baudelaire](https://github.com/HopeTS)
