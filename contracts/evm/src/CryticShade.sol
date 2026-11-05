// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Groth16Verifier} from "./Verifier.sol";
import {ShadePool} from "./ShadePool.sol";

/// @notice Short Medusa campaign target. Properties are balance conservation and a known root.
contract CryticShade {
    ShadePool internal immutable pool;
    uint256 internal tracked;

    // Medusa funds the harness by sending value with the creation transaction.
    constructor() payable {
        pool = new ShadePool(new Groth16Verifier(), 1);
    }

    receive() external payable {}

    function deposit(uint96 value) public {
        uint256 amount = (uint256(value) % 1000) + 1;
        if (address(this).balance < amount) return;
        try pool.deposit{value: amount}(1, 2, 3) returns (uint256) {
            tracked += amount;
        } catch {}
    }

    function property_balance() public view returns (bool) {
        return address(pool).balance == tracked;
    }

    function property_root_known() public view returns (bool) {
        return pool.knownRoots(pool.currentRoot());
    }
}
