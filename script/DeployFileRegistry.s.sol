// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {FileRegistry} from "../contracts/FileRegistry.sol";

interface Vm {
    function envUint(string calldata name) external returns (uint256 value);
    function envAddress(string calldata name) external returns (address value);
    function envString(string calldata name) external returns (string memory value);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

contract DeployFileRegistry {
    Vm private constant vm =
        Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (FileRegistry deployedContract) {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address worldIdRouter = vm.envAddress("WORLD_ID_ROUTER");
        string memory appId = vm.envString("WORLD_ID_APP_ID");
        string memory action = vm.envString("WORLD_ID_ACTION");

        vm.startBroadcast(deployerPrivateKey);
        deployedContract = new FileRegistry(worldIdRouter, appId, action);
        vm.stopBroadcast();
    }
}
