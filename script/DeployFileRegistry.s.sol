// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {FileRegistry} from "../contracts/FileRegistry.sol";

interface Vm {
    function envUint(string calldata name) external returns (uint256 value);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

contract DeployFileRegistry {
    Vm private constant vm =
        Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    event FileRegistryDeployed(address contractAddress);

    function run() external returns (FileRegistry deployedContract) {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");

        vm.startBroadcast(deployerPrivateKey);
        deployedContract = new FileRegistry();
        vm.stopBroadcast();

        emit FileRegistryDeployed(address(deployedContract));
    }
}
