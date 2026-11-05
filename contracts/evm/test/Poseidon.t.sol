// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PoseidonT3} from "../src/PoseidonT3.sol";
import {PoseidonT7} from "../src/PoseidonT7.sol";

/// @notice Hash vectors are poseidon-lite / circomlib BN254 x^5, shared with the Rust hasher.
contract PoseidonEquivalenceTest is Test {
    uint256 internal constant F = 21888242871839275222246405745257275088548364400416034343698204186575808495617;

    function testVectorsMatchCircomlib() public view {
        string memory json = vm.readFile("../shade-crypto/testdata/poseidon-vectors.json");
        uint256 count = vm.parseJsonUint(json, ".count");
        uint256 seenT3;
        uint256 seenT7;
        for (uint256 i = 0; i < count; i++) {
            string memory base = string.concat(".cases[", vm.toString(i), "]");
            string[] memory inputs = vm.parseJsonStringArray(json, string.concat(base, ".inputs"));
            uint256 expected = vm.parseUint(vm.parseJsonString(json, string.concat(base, ".hash")));
            if (inputs.length == 2) {
                uint256[2] memory preimage;
                preimage[0] = vm.parseUint(inputs[0]);
                preimage[1] = vm.parseUint(inputs[1]);
                assertEq(PoseidonT3.hash(preimage), expected);
                seenT3++;
            } else if (inputs.length == 6) {
                uint256[6] memory preimage;
                for (uint256 j = 0; j < 6; j++) {
                    preimage[j] = vm.parseUint(inputs[j]);
                }
                assertEq(PoseidonT7.hash(preimage), expected);
                seenT7++;
            }
        }
        assertGe(seenT3, 3);
        assertGe(seenT7, 3);
    }

    function testUnreducedInputsMatchTheReducedElement() public pure {
        uint256[2] memory two;
        uint256[2] memory twoAlias;
        two[0] = 5;
        two[1] = 9;
        twoAlias[0] = F + 5;
        twoAlias[1] = 9;
        assertEq(PoseidonT3.hash(two), PoseidonT3.hash(twoAlias));

        uint256[6] memory six;
        uint256[6] memory sixAlias;
        six[0] = 5;
        sixAlias[0] = F + 5;
        assertEq(PoseidonT7.hash(six), PoseidonT7.hash(sixAlias));
    }
}
