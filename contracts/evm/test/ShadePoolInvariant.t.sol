// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Groth16Verifier} from "../src/Verifier.sol";
import {ShadePool} from "../src/ShadePool.sol";

contract ShadePoolHandler is Test {
    ShadePool public pool;
    uint256 public tracked;
    uint256 public deposits;

    constructor(ShadePool pool_) {
        pool = pool_;
    }

    function deposit(uint96 blinding, uint96 rho, uint96 ownerPub, uint96 value) external {
        uint256 amount = bound(uint256(value), pool.minDeposit(), 1_000_000);
        vm.deal(address(this), amount);
        try pool.deposit{value: amount}(blinding, rho, ownerPub) {
            tracked += amount;
            deposits += 1;
        } catch {}
    }

    function garbageSpend(uint256 root, uint256 nullifier, address recipient) external {
        uint256 before = address(pool).balance;
        uint256[2] memory pA;
        uint256[2][2] memory pB;
        uint256[2] memory pC;
        uint256[7] memory pubSignals;
        pubSignals[0] = root;
        pubSignals[1] = nullifier;
        try pool.shieldedTransfer(pA, pB, pC, pubSignals, payable(recipient), payable(address(this))) {} catch {}
        require(address(pool).balance == before, "garbage spend moved funds");
        if (nullifier != 0) {
            require(pool.nullifiers(nullifier) == false || before == address(pool).balance, "nullifier");
        }
    }
}

contract ShadePoolInvariantTest is Test {
    ShadePool internal pool;
    ShadePoolHandler internal handler;

    function setUp() public {
        vm.chainId(46630);
        pool = new ShadePool(new Groth16Verifier(), 1);
        handler = new ShadePoolHandler(pool);
        targetContract(address(handler));
    }

    function invariant_conservationAndRoot() public view {
        assertEq(address(pool).balance, handler.tracked());
        assertTrue(pool.knownRoots(pool.currentRoot()));
        assertGe(pool.nextIndex(), handler.deposits());
    }

    function testFuzz_depositBelowMinimumReverts(uint96 value) public {
        uint256 amount = bound(uint256(value), 0, pool.minDeposit() - 1);
        vm.deal(address(this), amount);
        vm.expectRevert(ShadePool.ValueOutOfRange.selector);
        pool.deposit{value: amount}(1, 2, 3);
    }

    function testFuzz_garbageSpendDoesNotMoveFunds(uint256 root, uint256 nullifier) public {
        vm.deal(address(this), 10);
        pool.deposit{value: 10}(4, 5, 6);
        uint256 before = address(pool).balance;
        uint256[2] memory pA;
        uint256[2][2] memory pB;
        uint256[2] memory pC;
        uint256[7] memory pubSignals;
        pubSignals[0] = root % 1000 == 0 ? pool.currentRoot() : root;
        pubSignals[1] = nullifier;
        vm.expectRevert();
        pool.shieldedTransfer(pA, pB, pC, pubSignals, payable(address(this)), payable(address(1)));
        assertEq(address(pool).balance, before);
        assertFalse(pool.nullifiers(nullifier));
    }
}
