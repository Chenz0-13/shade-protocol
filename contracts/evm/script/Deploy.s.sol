// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {Groth16Verifier} from "../src/Verifier.sol";
import {ShadePool} from "../src/ShadePool.sol";

contract Deploy is Script {
    function run() external {
        uint256 chainId = block.chainid;
        require(chainId == 46630 || chainId == 99801 || chainId == 31337, "testnet or anvil only");
        uint256 key = vm.envUint("DEPLOYER_PRIVATE_KEY");
        vm.startBroadcast(key);
        Groth16Verifier verifier = new Groth16Verifier();
        uint256 minDeposit = vm.envOr("MIN_DEPOSIT", uint256(1));
        ShadePool pool = new ShadePool(verifier, minDeposit);
        vm.stopBroadcast();
        console2.log("verifier", address(verifier));
        console2.log("pool", address(pool));
    }
}
