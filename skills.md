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

---

## World Mini Apps API quick reference

- Base URL: `https://developer.worldcoin.org`. All endpoints below are relative to this base.
- Auth: The OpenAPI spec lists no security schema, but real calls generally include your developer token (e.g., `Authorization: Bearer <api_key>`) plus any app_id fields noted below.
- Rate/size constraints (per spec): notifications allow up to 1,000 wallet addresses per call; titles max 30 chars, messages max 200 chars.

### Identity / Proof
- `POST /api/v2/verify/{app_id}` — Cloud-side World ID proof verification for an action.
  - Path: `app_id`.
  - Body (`VerifyProofRequest`): `nullifier_hash` (req), `proof` (req), `merkle_root` (req), `verification_level` (req), `action` (req), optional `signal_hash`, optional `max_age` (seconds, 3600–604800, default 7200).
  - Use when you need server-side confirmation that a World ID proof for a given action is valid/fresh.

### Incognito actions
- `POST /api/v2/create-action/{app_id}` — Define an incognito action and derive its external nullifier.
  - Path: `app_id`.
  - Body (`CreateActionRequest`): `action` (req), optional `name`, `description`, `max_verifications` (default 1).
  - Response includes `external_nullifier` alongside action metadata.

### MiniKit transactions
- `GET /api/v2/minikit/transaction/{transaction_id}` — Fetch transaction status/details.
  - Path: `transaction_id`; Query: `app_id` (req), `type` (req, e.g., transaction flavor).
  - Response (`GetTransactionResponse`): `transaction_status` (`pending|mined|failed`), `transaction_hash`, `reference`, `from`, `to`, `token_amount` (BigInt string, 6 decimals), `token`, `chain`, `timestamp`, `app_id`.
- `GET /api/v2/minikit/transaction/debug` — Get Tenderly debug URLs for failed prepare-stage transactions.
  - Query: `app_id` (req).
  - Response: `transactions[]` with `debugUrl`, `createdAt`, `block`, `simulationRequestId`, `simulationError`, `walletAddress`.

### Notifications
- `POST /api/v2/minikit/send-notification` — Push a notification to opted-in users.
  - Body (`SendNotificationRequest`): `wallet_addresses` (req, array, <=1000), `title` (req, <=30 chars), `message` (req, <=200 chars, `${username}` placeholder allowed), `mini_app_path` (req, deep link: `worldapp://mini-app?app_id=[app_id]&path=[path]`), `app_id` (req).
  - Response: `success`, `status`, `result[]` per wallet (`sent`, `reason` if failed).

### Grants
- `GET /api/v2/minikit/user-grant-cycle` — Next grant claim date for a user.
  - Query: `wallet_address` (req), `app_id` (req).
  - Response: `result.nextGrantClaimUTCDate` (ISO datetime).

### Pricing
- `GET /public/v1/miniapps/prices` — Latest token prices in fiat.
  - Query: `fiatCurrencies` (req, comma-separated codes), `cryptoCurrencies` (req, comma-separated codes).
  - Response: `result.prices` keyed by currency code; each entry carries `asset`, `amount`, `decimals`, `symbol`.

### Credit (borrower lookup)
- `GET /api/borrower/{identifier}` — Borrower state/score by wallet address or World username.
  - Path: `identifier`.
  - Response (`CreditBorrower`): `state` (`INACTIVE|ACTIVE|DEFAULTED`), `score` (int >=0). On errors, `CreditError` schema may be returned.
