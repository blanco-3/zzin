# IDKit Tools (World ID) – Agent Quick Reference

This is a concise, action-oriented cheat sheet for using IDKit to perform Orb-verified World ID checks and proof verification.

## Core Client Tools
- **IDKit Widget/Modal (React/Web)**
  - Purpose: Collect World ID proof from an Orb-verified user.
  - Key props: `app_id`, `action`, `signal` (optional, unique per request), `walletConnectProjectId` (if needed), `autoClose`.
  - Event handlers: `onSuccess(result)`, `onError(error)`. `result` includes `{ merkle_root, nullifier_hash, proof, verification_level, credential_type, action, signal, timestamp }`.
  - Usage pattern:
    1. Generate a unique `signal` (e.g., nonce tied to user/session/content).
    2. Render IDKit and call `open()` (or show the component) to prompt for verification.
    3. On success, send `result` to the backend for server-side verification.
    4. If verification passes, persist the linkage (user/content/verification_level).

- **MiniKit Command (`MiniKit.commandsAsync.verify`)**
  - Purpose: In mini-apps, trigger the World ID verify flow natively.
  - Input: `{ action, signal?, verification_level? }`.
  - Output: `finalPayload` is either success `{ status: 'success', merkle_root, nullifier_hash, proof, verification_level, credential_type, action, signal }` or error `{ status: 'error', error_code }`.
  - Guard: Require `status === 'success'` before proceeding; otherwise block the flow.

## Server Verification
- **`verifyCloudProof` (idkit-core/backend)**
  - Purpose: Validate the proof server-side against Worldcoin’s verification service.
  - Input: `{ app_id, action, signal?, proof, merkle_root, nullifier_hash, verification_level }`.
  - Output: Resolves on success; throws on failure (check error codes/messages).
  - Best practices:
    - Always verify on the server to prevent client tampering.
    - Tie `signal` to a nonce or content hash to prevent replay.
    - Enforce minimum `verification_level` (e.g., `orb` for human verification).

## Required Parameters (mental checklist)
- `app_id`: Your World ID app identifier.
- `action`: A stable string that identifies the verification purpose (e.g., `zzin-orb-gate`).
- `signal`: Optional but recommended; unique per request. Bind to content hash or session nonce.
- `verification_level`: Use `orb` for Orb-verified users (default may be device if not set).

## Typical Flow (end-to-end)
1) Client: Trigger IDKit (or MiniKit verify) with `{ app_id, action, signal, verification_level: 'orb' }`.
2) Client: Receive proof bundle `{ proof, merkle_root, nullifier_hash, verification_level, credential_type, action, signal }`.
3) Client → Server: POST the bundle (plus any session identifiers).
4) Server: Call `verifyCloudProof` with the received fields and validate success.
5) Server: On success, persist linkage (user/address ↔ nullifier_hash ↔ content/signal). Reject on failure.

## Error Handling Patterns
- User cancellations: Treat as “not verified” and block access; do not proceed to main logic.
- Verification errors: Surface concise messages; log details server-side.
- Replay protection: Reject reused `signal`/`nullifier_hash` pairs if your app logic requires one-time use.

## Security Notes
- Never trust client-only verification; always re-verify server-side.
- Keep `app_id`/`action` consistent with your World ID configuration.
- Use HTTPS for all proof submissions; sanitize/log minimal PII.
