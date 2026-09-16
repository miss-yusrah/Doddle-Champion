// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {DoodleChampionTracker} from "../src/DoodleChampionTracker.sol";

/// @notice Deploys DoodleChampionTracker. Reads DEPLOYER_PRIVATE_KEY.
///
/// Usage (Celo mainnet):
///   forge script script/Deploy.s.sol:Deploy --rpc-url celo --broadcast
/// Usage (Celo Sepolia):
///   forge script script/Deploy.s.sol:Deploy --rpc-url celo_sepolia --broadcast
contract Deploy is Script {
    function run() external returns (DoodleChampionTracker tracker) {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        vm.startBroadcast(pk);
        tracker = new DoodleChampionTracker();
        vm.stopBroadcast();
        console.log("DoodleChampionTracker deployed at:", address(tracker));
    }
}
