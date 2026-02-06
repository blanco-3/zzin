// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IWorldID {
    /// @notice Verify a zero-knowledge proof of World ID membership and nullifier uniqueness.
    /// @param root The Merkle root of the World ID group.
    /// @param groupId The World ID group identifier (Orb = 1).
    /// @param signalHash The signal hashed to a field element (binds proof to an action or content hash).
    /// @param nullifierHash The nullifier hash for replay protection.
    /// @param externalNullifier The external nullifier (app/action specific).
    /// @param proof The zero-knowledge proof.
    function verifyProof(
        uint256 root,
        uint256 groupId,
        uint256 signalHash,
        uint256 nullifierHash,
        uint256 externalNullifier,
        uint256[8] calldata proof
    ) external view;
}

library ByteHasher {
    function hashToField(bytes memory value) internal pure returns (uint256) {
        // Matches World ID reference implementation: ensure value is within field.
        return uint256(keccak256(value)) >> 8;
    }
}

/**
 * @title FileRegistry
 * @dev Stores original file hashes on-chain and optionally links certified
 * (template-applied) variants back to the original hash for lookup.
 *
 * Registration requires a valid World ID Orb proof. Any caller can query.
 */
contract FileRegistry {
    using ByteHasher for bytes;

    uint256 public constant WORLD_ID_GROUP_ID = 1;

    /// @dev World ID verifier contract (WorldIDRouter).
    IWorldID public immutable worldId;

    /// @dev External nullifier tying proofs to this app/action (hash(appId, action)).
    uint256 public immutable externalNullifier;

    /// @dev Nullifier replay protection.
    mapping(uint256 => bool) public nullifierHashes;

    struct ImageMetadata {
        string location;
        string worldid;
        uint256 timestamp;
        bool usedZzin;
        bool exists;
    }

    /// @dev Original hash -> metadata.
    mapping(bytes32 => ImageMetadata) public map;
    /// @dev Original hash -> registered flag.
    mapping(bytes32 => bool) public isRegistered;
    /// @dev Original hash -> owner.
    mapping(bytes32 => address) public fileOwner;

    /// @dev Certified hash -> original hash (root).
    mapping(bytes32 => bytes32) public certifiedToOriginal;
    /// @dev Original hash -> head of certified hashes linked list.
    mapping(bytes32 => bytes32) public firstCertified;
    /// @dev Certified hash -> next certified hash for the same original.
    mapping(bytes32 => bytes32) public nextCertified;

    event FileRegistered(
        bytes32 indexed originalHash,
        address indexed fileOwner,
        string worldid,
        uint256 timestamp,
        bool usedZzin
    );

    event CertifiedLinked(bytes32 indexed originalHash, bytes32 indexed certifiedHash);

    constructor(address _worldId, string memory _appId, string memory _action) {
        require(_worldId != address(0), "Invalid WorldID address");
        worldId = IWorldID(_worldId);
        externalNullifier = abi
            .encodePacked(abi.encodePacked(_appId).hashToField(), _action)
            .hashToField();
    }

    /**
     * @notice Register an original file hash after validating a World ID proof (Orb-verified).
     * Signal binding: the `signal` for the proof must be `_originalHash` (bytes32),
     * hashed to field via `hashToField(abi.encodePacked(_originalHash))`.
     */
    function registerFile(
        bytes32 _originalHash,
        string calldata _worldid,
        uint256 _timestamp,
        bool _usedZzin,
        uint256 _root,
        uint256 _nullifierHash,
        uint256[8] calldata _proof
    ) external {
        _registerOriginal(_originalHash, _worldid, _timestamp, _usedZzin, _root, _nullifierHash, _proof);
    }

    /**
     * @notice Register an original hash and link a certified hash to it in one call.
     * @dev The certified hash is *not* separately Orb-gated; it's linked under the same proof
     * that is bound to `_originalHash`.
     */
    function registerFileWithCertificate(
        bytes32 _originalHash,
        bytes32 _certifiedHash,
        string calldata _worldid,
        uint256 _timestamp,
        bool _usedZzin,
        uint256 _root,
        uint256 _nullifierHash,
        uint256[8] calldata _proof
    ) external {
        _registerOriginal(_originalHash, _worldid, _timestamp, _usedZzin, _root, _nullifierHash, _proof);
        _linkCertified(_originalHash, _certifiedHash);
    }

    function _registerOriginal(
        bytes32 _originalHash,
        string calldata _worldid,
        uint256 _timestamp,
        bool _usedZzin,
        uint256 _root,
        uint256 _nullifierHash,
        uint256[8] calldata _proof
    ) internal {
        require(_originalHash != bytes32(0), "Invalid hash");
        require(!isRegistered[_originalHash], "Hash already registered");
        require(bytes(_worldid).length > 0, "Invalid worldid");
        require(_timestamp > 0, "Invalid timestamp");
        // NOTE:
        // World ID's nullifierHash is derived from (identity, externalNullifier).
        // In this contract, externalNullifier is constant (appId + action), so the
        // same person will always produce the same nullifierHash.
        //
        // We intentionally DO NOT enforce one-time-only usage of nullifierHash,
        // because ZZIN needs to allow a single verified user to register multiple
        // different photos (signals). Replay is still safe here because the proof
        // is bound to the signalHash (originalHash); a proof for one hash cannot
        // be reused for a different hash.

        uint256 signalHash = abi.encodePacked(_originalHash).hashToField();
        worldId.verifyProof(
            _root,
            WORLD_ID_GROUP_ID,
            signalHash,
            _nullifierHash,
            externalNullifier,
            _proof
        );

        string memory location = _usedZzin ? "zzin" : "external";

        isRegistered[_originalHash] = true;
        map[_originalHash] = ImageMetadata({
            location: location,
            worldid: _worldid,
            timestamp: _timestamp,
            usedZzin: _usedZzin,
            exists: true
        });
        fileOwner[_originalHash] = msg.sender;
        emit FileRegistered(_originalHash, msg.sender, _worldid, _timestamp, _usedZzin);
    }

    /**
     * @notice Link an additional certified hash to an already-registered original.
     * @dev Only the original owner can link more certified variants.
     */
    function linkCertificate(bytes32 _originalHash, bytes32 _certifiedHash) external {
        require(isRegistered[_originalHash], "Original not registered");
        require(fileOwner[_originalHash] == msg.sender, "Not original owner");
        _linkCertified(_originalHash, _certifiedHash);
    }

    function _linkCertified(bytes32 _originalHash, bytes32 _certifiedHash) internal {
        require(_certifiedHash != bytes32(0), "Invalid certified hash");
        require(_certifiedHash != _originalHash, "Certified must differ");
        require(certifiedToOriginal[_certifiedHash] == bytes32(0), "Certified already linked");

        certifiedToOriginal[_certifiedHash] = _originalHash;
        nextCertified[_certifiedHash] = firstCertified[_originalHash];
        firstCertified[_originalHash] = _certifiedHash;

        emit CertifiedLinked(_originalHash, _certifiedHash);
    }

    function resolveOriginalHash(bytes32 _anyHash) external view returns (bytes32 originalHash) {
        if (isRegistered[_anyHash]) return _anyHash;
        return certifiedToOriginal[_anyHash];
    }

    function getFileOwner(bytes32 _fileHash) external view returns (address) {
        return fileOwner[_fileHash];
    }

    function isFileRegistered(bytes32 _fileHash) external view returns (bool) {
        return isRegistered[_fileHash];
    }

    function getImageMetadata(
        bytes32 _fileHash
    )
        external
        view
        returns (
            string memory location,
            string memory worldid,
            uint256 timestamp,
            bool usedZzin,
            bool exists
        )
    {
        ImageMetadata memory metadata = map[_fileHash];
        return (
            metadata.location,
            metadata.worldid,
            metadata.timestamp,
            metadata.usedZzin,
            metadata.exists
        );
    }

    function isNullifierUsed(uint256 _nullifierHash) external view returns (bool) {
        return nullifierHashes[_nullifierHash];
    }
}
