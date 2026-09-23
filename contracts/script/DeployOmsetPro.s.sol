// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {OmsetPro} from "../src/OmsetPro.sol";

/// @notice Deploys OmsetPro using the account selected through Foundry's keystore flow.
contract DeployOmsetPro is Script {
    function run() external returns (OmsetPro deployment) {
        vm.startBroadcast();
        deployment = new OmsetPro();
        vm.stopBroadcast();
    }
}
