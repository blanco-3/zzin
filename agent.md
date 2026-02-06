# Agent Notes

## Preconditions
- Access is limited to users who are already Orb-verified (World ID).
- On app start, the user must pass Orb verification before any main logic runs.

## Core Functionality
- Only media captured through this app (photo/video; future content types may be added) is allowed.
- Captured files are hashed, aggregated into a Merkle tree, and the Merkle root is stored on-chain via the contract.

## World ID / Identity Verification
- For implementing or calling identity (Orb/World ID) tools, see `skills.md` for a quick reference to IDKit and MiniKit verification flows.

## Media Registration & Verification (Original vs Certified)
- When a photo is taken, produce two hashes:
  - Original image hash.
  - Certified image hash (original with a template/watermark applied).
- On-chain storage:
  - Store original image metadata keyed by original hash: `originalData[hash] = CertData{timestamp, worldid, ...}`.
  - Map certified hash back to original hash: `certToOriginal[certHash] = originalHash`.
- Verification function shape:
  ```solidity
  function verify(bytes memory image) public view returns (CertData memory) {
      bytes32 hash = keccak256(image);
      // Case 1: original submitted
      if (originalData[hash].timestamp != 0) {
          return originalData[hash];
      }
      // Case 2: certified submitted (map back to original)
      bytes32 originalHash = certToOriginal[hash];
      return originalData[originalHash];
  }
  ```
- Result: Submitting either the original file or the certified (templated) file returns the original’s metadata, while keeping certified→original linkage on-chain.

## Verification Flow (for a submitted photo/video)
1) The app hashes the provided media.
2) The on-chain Merkle root is retrieved from the contract.
3) The media hash is checked against the Merkle tree rooted by that Merkle root.
4) If the hash is included, the media is verified as human-generated via this app.
