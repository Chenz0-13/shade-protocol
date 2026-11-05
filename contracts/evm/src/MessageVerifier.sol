// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Two independent transports must submit the same payload.
/// A single transport is not enough. Attestation also consumes an epoch value cap.
/// The first wired lane is Robinhood Chain testnet (46630) to Kinetiq Elysium testnet (99801).
contract TwoOfTwoVerifier {
    address public immutable transportA;
    address public immutable transportB;
    uint256 public immutable epochLength;
    uint256 public immutable epochCap;
    uint256 public epoch;
    uint256 public epochUsed;

    mapping(bytes32 => bytes32) public voteA;
    mapping(bytes32 => bytes32) public voteB;
    mapping(bytes32 => bool) public attested;
    mapping(bytes32 => bool) public consumed;

    error NotTransport();
    error AlreadyAttested();
    error CapExceeded();
    error NotAttested();
    error Consumed();

    constructor(address transportA_, address transportB_, uint256 epochLength_, uint256 epochCap_) {
        require(transportA_ != address(0) && transportB_ != address(0) && transportA_ != transportB_, "transports");
        require(epochLength_ > 0 && epochCap_ > 0, "cap");
        transportA = transportA_;
        transportB = transportB_;
        epochLength = epochLength_;
        epochCap = epochCap_;
    }

    function submit(bytes32 messageId, uint256 destChain, uint256 commitment, uint256 nullifier, uint256 amount)
        external
    {
        if (msg.sender != transportA && msg.sender != transportB) revert NotTransport();
        if (attested[messageId]) revert AlreadyAttested();
        bytes32 body = keccak256(abi.encode(destChain, commitment, nullifier, amount));
        if (msg.sender == transportA) voteA[messageId] = body;
        else voteB[messageId] = body;
        if (voteA[messageId] != bytes32(0) && voteA[messageId] == voteB[messageId]) {
            _charge(amount);
            attested[messageId] = true;
        }
    }

    function verify(bytes32 messageId, uint256 destChain, uint256 commitment, uint256 nullifier, uint256 amount)
        external
        view
        returns (bool)
    {
        bytes32 body = keccak256(abi.encode(destChain, commitment, nullifier, amount));
        return attested[messageId] && !consumed[messageId] && voteA[messageId] == body;
    }

    function consume(bytes32 messageId) external {
        if (!attested[messageId] || consumed[messageId]) revert NotAttested();
        consumed[messageId] = true;
    }

    function _charge(uint256 amount) internal {
        uint256 current = block.timestamp / epochLength;
        if (current != epoch) {
            epoch = current;
            epochUsed = 0;
        }
        if (epochUsed + amount > epochCap) revert CapExceeded();
        epochUsed += amount;
    }
}

/// @notice Test and local transport. Production lanes replace this with a real mailbox.
contract MockTransport {
    function deliver(
        TwoOfTwoVerifier verifier,
        bytes32 messageId,
        uint256 destChain,
        uint256 commitment,
        uint256 nullifier,
        uint256 amount
    ) external {
        verifier.submit(messageId, destChain, commitment, nullifier, amount);
    }
}

/// @notice NOT WIRED. Hyperlane adapter stub. Do not treat this as a live transport.
contract HyperlaneAdapter {
    error NotWired();

    function deliver(bytes calldata) external pure {
        revert NotWired();
    }
}

/// @notice NOT WIRED. LayerZero adapter stub. Do not treat this as a live transport.
contract LayerZeroAdapter {
    error NotWired();

    function deliver(bytes calldata) external pure {
        revert NotWired();
    }
}
