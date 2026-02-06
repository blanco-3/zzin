## Create a Mini App

[Mini apps](https://docs.worldcoin.org/mini-apps) enable third-party developers to create native-like applications within World App.

This template is a way for you to quickly get started with authentication and examples of some of the trickier commands.

## Getting Started

1. cp .env.sample .env.local (or cp .env.example .env.local)
2. Follow the instructions in the .env.local file
3. Run `npm run dev`
4. Run `ngrok http 3000`
5. Run `npx auth secret` and set the output as `AUTH_SECRET` in `.env.local`
6. Add your domain to the `allowedDevOrigins` in the next.config.ts file.
7. [For Testing] If you're using a proxy like ngrok, you need to update the `AUTH_URL` in the .env.local file to your ngrok url.
8. Continue to developer.worldcoin.org and make sure your app is connected to the right ngrok url
9. [Optional] For Verify and Send Transaction to work you need to do some more setup in the dev portal. The steps are outlined in the respective component files.

## Authentication

This starter kit uses [Minikit's](https://github.com/worldcoin/minikit-js) wallet auth to authenticate users, and [next-auth](https://authjs.dev/getting-started) to manage sessions.

## UI Library

This starter kit uses [Mini Apps UI Kit](https://github.com/worldcoin/mini-apps-ui-kit) to style the app. We recommend using the UI kit to make sure you are compliant with [World App's design system](https://docs.world.org/mini-apps/design/app-guidelines).

## Eruda

[Eruda](https://github.com/liriliri/eruda) is a tool that allows you to inspect the console while building as a mini app. You should disable this in production.

## Contributing

This template was made with help from the amazing [supercorp-ai](https://github.com/supercorp-ai) team.

## File Integrity (On-chain Hash Registry)

This project now includes a file integrity flow:

1. Compute `Keccak-256` hash in the browser
2. Verify wallet via Address Book (`getIsUserVerified`)
3. Submit transaction from the user wallet (`MiniKit.commandsAsync.sendTransaction`)
4. Verify hash ownership via `POST /api/verify-file`

Transaction payload fields (`registerFile`):
- `worldid`: username from `MiniKit.getUserByAddress(userAddress).username`
- `timestamp`: photo creation timestamp (unix seconds)
- `usedZzin`: whether created with ZZIN (`true` / `false`)

Verification output fields (`map[imageHash]`):
- `location`
- `worldid`
- `timestamp`
- `usedZzin`
- `exists`

### Smart Contract

- Contract: `contracts/FileRegistry.sol`
- ABI: `src/abi/FileRegistry.json`
- Core functions:
  - `registerFile(bytes32 _fileHash, string _worldid, uint256 _timestamp, bool _usedZzin)`
  - `getImageMetadata(bytes32 _fileHash)`
  - `getFileOwner(bytes32 _fileHash)`
  - `isFileRegistered(bytes32 _fileHash)`

Compile and refresh ABI:

```bash
npx --yes solc --abi contracts/FileRegistry.sol -o .tmp-solc
cat .tmp-solc/contracts_FileRegistry_sol_FileRegistry.abi | jq '.' > src/abi/FileRegistry.json
```

### Deploy Test Contract (Worldchain Sepolia)

1. Prepare a funded deployer private key for Worldchain Sepolia.
2. Run:

```bash
DEPLOYER_PRIVATE_KEY=0xyour_private_key_here npm run deploy:file-registry:sepolia
```

Optional custom RPC:

```bash
DEPLOYER_PRIVATE_KEY=0xyour_private_key_here \
DEPLOY_RPC_URL=https://your-worldchain-sepolia-rpc \
npm run deploy:file-registry:sepolia
```

Deploying to mainnet:

```bash
DEPLOYER_PRIVATE_KEY=0xyour_private_key_here npm run deploy:file-registry:mainnet
```

The deploy script updates `.env.local` automatically with:
- `NEXT_PUBLIC_FILE_REGISTRY_CONTRACT_ADDRESS`
- `NEXT_PUBLIC_FILE_REGISTRY_RPC_URL`
- `NEXT_PUBLIC_FILE_REGISTRY_EXPLORER_BASE_URL`
- `FILE_REGISTRY_CONTRACT_ADDRESS`
- `FILE_REGISTRY_RPC_URL`
- `FILE_REGISTRY_EXPLORER_BASE_URL`

### Required Environment Variables

- `NEXT_PUBLIC_FILE_REGISTRY_CONTRACT_ADDRESS`: deployed contract address (for client transaction)
- `NEXT_PUBLIC_FILE_REGISTRY_RPC_URL`: RPC URL (optional; worldchain public RPC is default)
- `NEXT_PUBLIC_FILE_REGISTRY_EXPLORER_BASE_URL`: explorer base URL (optional; `https://worldscan.org` default)

Legacy server relay (`1.b`) variables are still available:
- `FILE_REGISTRY_CONTRACT_ADDRESS`
- `FILE_REGISTRY_PRIVATE_KEY`
- `FILE_REGISTRY_RPC_URL`
- `FILE_REGISTRY_EXPLORER_BASE_URL`
