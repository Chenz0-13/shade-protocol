// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Groth16Verifier} from "../src/Verifier.sol";
import {ShadePool} from "../src/ShadePool.sol";

contract ShadePoolTest is Test {
    ShadePool internal pool;
    address payable internal recipient = payable(address(0xBEEF));
    address payable internal relayer = payable(address(0xCAFE));

    function setUp() public {
        vm.chainId(46630);
        pool = new ShadePool(new Groth16Verifier(), 1);
    }

    function testDepositRejectsZero() public {
        vm.expectRevert(ShadePool.ValueOutOfRange.selector);
        pool.deposit(1, 2, 3);
    }

    function testDepositBelowTheConfiguredMinimumReverts() public {
        ShadePool strict = new ShadePool(pool.verifier(), 1000);
        vm.deal(address(this), 1);
        vm.expectRevert(ShadePool.ValueOutOfRange.selector);
        strict.deposit{value: 1}(1, 2, 3);
    }

    function testDepositThenWithdrawPaysRecipientAndRelayerSeparately() public {
        string memory json = _proofJson(address(pool));
        uint256 value = vm.parseJsonUint(json, ".value");
        uint256 withdrawAmount = vm.parseJsonUint(json, ".withdraw");
        uint256 relayerFee = vm.parseJsonUint(json, ".relayerFee");
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
        uint256[7] memory pubSignals = _seven(json, ".pub");
        vm.expectRevert(ShadePool.ExtDataMismatch.selector);
        pool.shieldedTransfer(pA, pB, pC, pubSignals, payable(address(0x1111)), relayer);
        pool.shieldedTransfer(pA, pB, pC, pubSignals, recipient, relayer);
        assertEq(recipient.balance, withdrawAmount);
        assertEq(relayer.balance, relayerFee);
        assertEq(address(pool).balance, 0);
        assertTrue(withdrawAmount > 0 && relayerFee > 0);
        assertTrue(withdrawAmount != relayerFee);
        assertTrue(pool.nullifiers(pubSignals[1]));

        vm.expectRevert(ShadePool.NullifierSpent.selector);
        pool.shieldedTransfer(pA, pB, pC, pubSignals, recipient, relayer);
    }

    /// Replaying a proof against a second pool is the cross-deployment attack.
    /// The extDataHash domain includes the pool address, so the second pool rejects it
    /// even when the note and the Merkle root match.
    function testProofForOnePoolCannotPayAnotherPool() public {
        string memory json = _proofJson(address(pool));
        uint256 value = vm.parseJsonUint(json, ".value");
        uint256 blinding = vm.parseJsonUint(json, ".blinding");
        uint256 rho = vm.parseJsonUint(json, ".rho");
        uint256 owner = vm.parseJsonUint(json, ".owner");
        vm.deal(address(this), value * 2);
        pool.deposit{value: value}(blinding, rho, owner);

        ShadePool other = new ShadePool(pool.verifier(), 1);
        other.deposit{value: value}(blinding, rho, owner);
        assertEq(other.currentRoot(), pool.currentRoot());

        uint256[2] memory pA = _pair(json, ".pA");
        uint256[2][2] memory pB = _quad(json, ".pB");
        uint256[2] memory pC = _pair(json, ".pC");
        uint256[7] memory pubSignals = _seven(json, ".pub");
        vm.expectRevert(ShadePool.ExtDataMismatch.selector);
        other.shieldedTransfer(pA, pB, pC, pubSignals, recipient, relayer);
        assertEq(address(other).balance, value);
        assertFalse(other.nullifiers(pubSignals[1]));
    }

    function testUnknownRootRejectedBeforeTheVerifier() public {
        uint256[2] memory pA;
        uint256[2][2] memory pB;
        uint256[2] memory pC;
        uint256[7] memory pubSignals;
        pubSignals[0] = 123;
        vm.expectRevert(ShadePool.UnknownRoot.selector);
        pool.shieldedTransfer(pA, pB, pC, pubSignals, recipient, relayer);
    }

    function _proofJson(address poolAddress) internal returns (string memory) {
        string[] memory cmd = new string[](6);
        cmd[0] = "node";
        cmd[1] = "../../scripts/evm-proof.mjs";
        cmd[2] = "--pool";
        cmd[3] = vm.toString(poolAddress);
        cmd[4] = "--relayer-hex";
        cmd[5] = vm.toString(relayer);
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

    function _seven(string memory json, string memory key) internal pure returns (uint256[7] memory out) {
        for (uint256 i = 0; i < 7; i++) {
            out[i] = vm.parseJsonUint(json, string.concat(key, "[", vm.toString(i), "]"));
        }
    }
}
