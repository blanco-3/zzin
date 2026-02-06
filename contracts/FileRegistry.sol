// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IWorldIdAddressBook {
    function addressVerifiedUntil(address) external view returns (uint256);
}

/**
 * @title FileRegistry
 * @dev Stores file hashes on-chain. Any caller can query, but only verified
 * World ID addresses (Address Book) can register.
 */
contract FileRegistry {
    address public constant WORLD_ID_ADDRESS_BOOK =
        0x57b930D551e677CC36e2fA036Ae2fe8FdaE0330D;

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

    event FileRegistered(
        bytes32 indexed fileHash,
        address indexed fileOwner,
        string worldid,
        uint256 timestamp,
        bool usedZzin
    );

    modifier onlyVerifiedUser() {
        uint256 verifiedUntil = IWorldIdAddressBook(WORLD_ID_ADDRESS_BOOK)
            .addressVerifiedUntil(msg.sender);
        require(verifiedUntil > block.timestamp, "World ID verification required");
        _;
    }

    function registerFile(
        bytes32 _fileHash,
        string calldata _worldid,
        uint256 _timestamp,
        bool _usedZzin
    ) external onlyVerifiedUser {
        require(_fileHash != bytes32(0), "Invalid hash");
        require(!isRegistered[_fileHash], "Hash already registered");
        require(bytes(_worldid).length > 0, "Invalid worldid");
        require(_timestamp > 0, "Invalid timestamp");

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
}
