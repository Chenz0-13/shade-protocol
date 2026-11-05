// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Groth16Verifier} from "../src/Verifier.sol";
import {ShadePool} from "../src/ShadePool.sol";

contract ShadePoolTest is Test {
    ShadePool internal pool;
    address payable internal recipient = payable(address(0xBEEF));

    function setUp() public {
        vm.chainId(46630);
        pool = new ShadePool(new Groth16Verifier());
    }

    function testDepositRejectsZero() public {
        vm.expectRevert(ShadePool.ValueOutOfRange.selector);
        pool.deposit(1, 2, 3);
    }

    function testDepositThenWithdrawVerifiesTheProof() public {
        string memory json = _proofJson();
        uint256 value = vm.parseJsonUint(json, ".value");
        uint256 blinding = vm.parseJsonUint(json, ".blinding");
        uint256 rho = vm.parseJsonUint(json, ".rho");
        uint256 owner = vm.parseJsonUint(json, ".owner");
        uint256 root = vm.parseJsonUint(json, ".root");

        vm.deal(address(this), value);
        pool.deposit{value: value}(blinding, rho, owner);
        assertEq(pool.currentRoot(), root);
        assertEq(address(pool).balance, value);

        uint256[2] memory pA = _pair(json, ".pA");
        uint256[2][2] memory pB = _quad(json, ".pB");
        uint256[2] memory pC = _pair(json, ".pC");
        uint256[6] memory pubSignals = _six(json, ".pub");
        vm.expectRevert(ShadePool.ExtDataMismatch.selector);
        pool.shieldedTransfer(pA, pB, pC, pubSignals, payable(address(0xCAFE)), address(0));
        pool.shieldedTransfer(pA, pB, pC, pubSignals, recipient, address(0));
        assertEq(recipient.balance, value);
        assertEq(address(pool).balance, 0);
        assertTrue(pool.nullifiers(pubSignals[1]));

        vm.expectRevert(ShadePool.NullifierSpent.selector);
        pool.shieldedTransfer(pA, pB, pC, pubSignals, recipient, address(0));
    }

    /// Robinhood Chain testnet (46630) rejects deployed code larger than 98304 bytes.
    function testRuntimeCodeFitsRobinhood() public view {
        assertLt(vm.getDeployedCode("PoseidonT3.sol:PoseidonT3").length, 98304);
        assertLt(vm.getDeployedCode("PoseidonT7.sol:PoseidonT7").length, 98304);
        assertLt(vm.getDeployedCode("ShadePool.sol:ShadePool").length, 98304);
        assertLt(vm.getDeployedCode("Verifier.sol:Groth16Verifier").length, 98304);
        assertLt(vm.getCode("PoseidonT7.sol:PoseidonT7").length, 98304);
    }

    function testUnknownRootRejectedBeforeTheVerifier() public {
        uint256[2] memory pA;
        uint256[2][2] memory pB;
        uint256[2] memory pC;
        uint256[6] memory pubSignals;
        pubSignals[0] = 123;
        vm.expectRevert(ShadePool.UnknownRoot.selector);
        pool.shieldedTransfer(pA, pB, pC, pubSignals, recipient, address(0));
    }

    function _proofJson() internal returns (string memory) {
        string[] memory cmd = new string[](2);
        cmd[0] = "node";
        cmd[1] = "../../scripts/evm-proof.mjs";
        return string(vm.ffi(cmd));
    }

    function _pair(string memory json, string memory key) internal pure returns (uint256[2] memory out) {
        out[0] = vm.parseJsonUint(json, string.concat(key, "[0]"));
        out[1] = vm.parseJsonUint(json, string.concat(key, "[1]"));
    }

    function _quad(string memory json, string memory key) internal pure returns (uint256[2][2] memory out) {
        out[0][0] = vm.parseJsonUint(json, string.concat(key, "[0][0]"));
        out[0][1] = vm.parseJsonUint(json, string.concat(key, "[0][1]"));
        out[1][0] = vm.parseJsonUint(json, string.concat(key, "[1][0]"));
        out[1][1] = vm.parseJsonUint(json, string.concat(key, "[1][1]"));
    }

    function _six(string memory json, string memory key) internal pure returns (uint256[6] memory out) {
        for (uint256 i = 0; i < 6; i++) {
            out[i] = vm.parseJsonUint(json, string.concat(key, "[", vm.toString(i), "]"));
        }
    }
}
