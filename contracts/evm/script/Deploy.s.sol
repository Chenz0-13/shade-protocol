// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {Groth16Verifier} from "../src/Verifier.sol";
import {ShadePool} from "../src/ShadePool.sol";

contract Deploy is Script {
    function run() external {
        uint256 chainId = block.chainid;
        require(chainId == 46630 || chainId == 31337, "testnet or anvil only");
        vm.startBroadcast();
        Groth16Verifier verifier = new Groth16Verifier();
        ShadePool pool = new ShadePool(verifier);
        vm.stopBroadcast();
        console2.log("verifier", address(verifier));
        console2.log("pool", address(pool));
    }
}
