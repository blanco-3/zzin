# Agent Notes

## Preconditions
- Access is limited to users who are already Orb-verified (World ID).
- On app start, the user must pass Orb verification before any main logic runs.

## Core Functionality
- Only media captured through this app (photo/video; future content types may be added) is allowed.
- Captured files are hashed, aggregated into a Merkle tree, and the Merkle root is stored on-chain via the contract.

## World ID / Identity Verification
- For implementing or calling identity (Orb/World ID) tools, see `skills.md` for a quick reference to IDKit and MiniKit verification flows.

## Verification Flow (for a submitted photo/video)
1) The app hashes the provided media.
2) The on-chain Merkle root is retrieved from the contract.
3) The media hash is checked against the Merkle tree rooted by that Merkle root.
4) If the hash is included, the media is verified as human-generated via this app.
