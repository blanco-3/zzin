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
    uint256 internal constant SNARK_SCALAR_FIELD =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    function hashToField(bytes memory value) internal pure returns (uint256) {
        return uint256(keccak256(value)) % SNARK_SCALAR_FIELD;
    }
}

/**
 * @title FileRegistry (Orb-gated)
 * @dev Stores file hashes on-chain. Registration requires a valid World ID Orb proof.
 */
contract FileRegistry {
    using ByteHasher for bytes;

    /// @dev World ID group ID for Orb-verified users.
    uint256 public constant WORLD_ID_GROUP_ID = 1;

    /// @dev World ID verifier contract.
    IWorldID public immutable worldId;

    /// @dev External nullifier tying proofs to this app/action (e.g., hash(appId, action)).
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

    mapping(bytes32 => ImageMetadata) public map;
    mapping(bytes32 => bool) public isRegistered;
    mapping(bytes32 => address) public fileOwner;

    constructor(address _worldId, uint256 _externalNullifier) {
        require(_worldId != address(0), "Invalid WorldID address");
        require(_externalNullifier != 0, "Invalid external nullifier");
        worldId = IWorldID(_worldId);
        externalNullifier = _externalNullifier;
    }

    event FileRegistered(
        bytes32 indexed fileHash,
        address indexed fileOwner,
        string worldid,
        uint256 timestamp,
        bool usedZzin
    );

    /**
     * @notice Register a file hash after validating a World ID proof (Orb-verified).
     * @param _fileHash Keccak-256 hash of the file.
     * @param _worldid World ID handle or identifier for display.
     * @param _timestamp File timestamp (e.g., lastModified).
     * @param _usedZzin Whether the file originated from the ZZIN app.
     * @param _root Merkle root from World ID proof.
     * @param _nullifierHash Nullifier hash to prevent proof reuse.
     * @param _proof World ID zero-knowledge proof.
     *
     * Signal binding: the `signal` for the proof must be the `_fileHash` (bytes32),
     * hashed to field via `hashToField(abi.encodePacked(_fileHash))`.
     */
    function registerFile(
        bytes32 _fileHash,
        string calldata _worldid,
        uint256 _timestamp,
        bool _usedZzin,
        uint256 _root,
        uint256 _nullifierHash,
        uint256[8] calldata _proof
    ) external {
        require(_fileHash != bytes32(0), "Invalid hash");
        require(!isRegistered[_fileHash], "Hash already registered");
        require(bytes(_worldid).length > 0, "Invalid worldid");
        require(_timestamp > 0, "Invalid timestamp");
        require(!nullifierHashes[_nullifierHash], "Nullifier already used");

        // Bind the proof to this file hash as the signal.
        uint256 signalHash = abi.encodePacked(_fileHash).hashToField();

        worldId.verifyProof(
            _root,
            WORLD_ID_GROUP_ID,
            signalHash,
            _nullifierHash,
            externalNullifier,
            _proof
        );

        nullifierHashes[_nullifierHash] = true;

        string memory location = _usedZzin ? "zzin" : "external";

        isRegistered[_fileHash] = true;
        map[_fileHash] = ImageMetadata({
            location: location,
            worldid: _worldid,
            timestamp: _timestamp,
            usedZzin: _usedZzin,
            exists: true
        });
        fileOwner[_fileHash] = msg.sender;
        emit FileRegistered(_fileHash, msg.sender, _worldid, _timestamp, _usedZzin);
    }

    function getFileOwner(bytes32 _fileHash) external view returns (address) {
        return fileOwner[_fileHash];
    }

    function isFileRegistered(bytes32 _fileHash) external view returns (bool) {
        return isRegistered[_fileHash];
    }

    function getImageMetadata(bytes32 _fileHash)
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
