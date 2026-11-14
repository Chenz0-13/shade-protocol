// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Groth16Verifier} from "../src/Verifier.sol";
import {ShadePool} from "../src/ShadePool.sol";
import {HyperlaneAdapter, LayerZeroAdapter, MockTransport, TwoOfTwoVerifier} from "../src/MessageVerifier.sol";

contract TeleportTest is Test {
    ShadePool internal pool;
    MockTransport internal transportA;
    MockTransport internal transportB;
    TwoOfTwoVerifier internal verifier;

    uint256 internal constant ELYSIUM = 99801;
    bytes32 internal constant MESSAGE = keccak256("lane-1");

    function setUp() public {
        vm.chainId(46630);
        pool = new ShadePool(new Groth16Verifier(), 1);
        transportA = new MockTransport();
        transportB = new MockTransport();
        verifier = new TwoOfTwoVerifier(address(transportA), address(transportB), 1 hours, 100);
        pool.setMessageVerifier(address(verifier));
    }

    function testHappyPathMintsOnlyAfterBothTransportsAgree() public {
        uint256 before = pool.nextIndex();
        transportA.deliver(verifier, MESSAGE, 46630, 11, 22, 40);
        vm.expectRevert(ShadePool.MessageRejected.selector);
        pool.mintAttested(MESSAGE, 11, 22, 40);
        transportB.deliver(verifier, MESSAGE, 46630, 11, 22, 40);
        pool.mintAttested(MESSAGE, 11, 22, 40);
        assertEq(pool.nextIndex(), before + 1);
        assertTrue(pool.nullifiers(22));
        assertTrue(pool.knownRoots(pool.currentRoot()));
    }

    function testReplayIsRejected() public {
        transportA.deliver(verifier, MESSAGE, 46630, 11, 22, 40);
        transportB.deliver(verifier, MESSAGE, 46630, 11, 22, 40);
        pool.mintAttested(MESSAGE, 11, 22, 40);
        assertTrue(pool.nullifiers(22));
        vm.expectRevert(ShadePool.MessageRejected.selector);
        pool.mintAttested(MESSAGE, 11, 22, 40);
        assertTrue(pool.nullifiers(22));
    }

    function testEpochCapIsEnforced() public {
        transportA.deliver(verifier, MESSAGE, 46630, 11, 22, 80);
        transportB.deliver(verifier, MESSAGE, 46630, 11, 22, 80);
        bytes32 second = keccak256("lane-2");
        transportA.deliver(verifier, second, 46630, 12, 23, 30);
        vm.expectRevert(TwoOfTwoVerifier.CapExceeded.selector);
        transportB.deliver(verifier, second, 46630, 12, 23, 30);
        vm.expectRevert(ShadePool.MessageRejected.selector);
        pool.mintAttested(second, 12, 23, 30);
        assertEq(verifier.epochUsed(), 80);
    }

    function testSingleTransportIsRejected() public {
        transportA.deliver(verifier, MESSAGE, ELYSIUM, 11, 22, 40);
        assertFalse(verifier.verify(MESSAGE, 46630, 11, 22, 40));
        vm.expectRevert(ShadePool.MessageRejected.selector);
        pool.mintAttested(MESSAGE, 11, 22, 40);
        HyperlaneAdapter hyperlane = new HyperlaneAdapter();
        LayerZeroAdapter layerZero = new LayerZeroAdapter();
        vm.expectRevert(HyperlaneAdapter.NotWired.selector);
        hyperlane.deliver("");
        vm.expectRevert(LayerZeroAdapter.NotWired.selector);
        layerZero.deliver("");
    }
}
