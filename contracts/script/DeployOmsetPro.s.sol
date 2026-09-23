// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {OmsetPro} from "../src/OmsetPro.sol";

/// @notice Deploys OmsetPro using the account selected through Foundry's keystore flow.
contract DeployOmsetPro is Script {
    function run() external returns (OmsetPro deployment) {
        address feeRecipient = vm.envAddress("OMSETPRO_FEE_RECIPIENT");
        vm.startBroadcast();
        deployment = new OmsetPro(feeRecipient);
        vm.stopBroadcast();
    }
}
