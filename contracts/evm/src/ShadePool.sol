// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Groth16Verifier} from "./Verifier.sol";
import {PoseidonT3} from "./PoseidonT3.sol";
import {PoseidonT7} from "./PoseidonT7.sol";

/// @notice Devnet shielded pool. Deposits are public native coins; spends are Groth16.
/// The verifier key is the repository's single-party development setup.
/// Tree depth 20 uses an incremental frontier, not a stored leaf array.
contract ShadePool {
    uint256 public constant DEPTH = 20;
    uint256 public constant ASSET = 1;
    uint256 public constant DOMAIN_COMMITMENT = 1;
    uint256 public constant DOMAIN_NULLIFIER = 2;
    uint256 public constant DOMAIN_OWNER = 3;
    uint256 public constant DOMAIN_EXT = 5;
    uint256 public constant DOMAIN_ASSET = 7;
    uint256 public constant DOMAIN_CHAIN = 9;
    uint256 internal constant FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;

    Groth16Verifier public immutable verifier;
    uint256 public immutable minDeposit;
    address public immutable owner;
    address public assetToken;
    uint256 public assetId = 1;
    address public messageVerifier;

    uint256 public nextIndex;
    uint256 public currentRoot;
    uint256[21] public zeros;
    uint256[20] public filled;
    mapping(uint256 => bool) public knownRoots;
    mapping(uint256 => bool) public nullifiers;

    event Deposited(uint256 indexed commitment, uint256 value, uint256 root, uint256 index);
    event TokenBound(address indexed token, uint256 assetId);
    event Spent(
        uint256 indexed nullifier,
        uint256 out1,
        uint256 out2,
        uint256 withdrawAmount,
        uint256 relayerFee,
        uint256 root
    );

    error UnknownRoot();
    error NullifierSpent();
    error InvalidProof();
    error ValueOutOfRange();
    error FieldOverflow();
    error TreeFull();
    error ExtDataMismatch();
    error MessageRejected();
    error VerifierSet();
    error NotOwner();
    error TokenMode();
    error Reentrancy();

    uint256 internal constant MASK128 = (uint256(1) << 128) - 1;
    uint256 private entered = 1;

    modifier nonReentrant() {
        if (entered != 1) revert Reentrancy();
        entered = 2;
        _;
        entered = 1;
    }

    constructor(Groth16Verifier verifier_, uint256 minDeposit_) {
        if (minDeposit_ == 0 || minDeposit_ > type(uint64).max) revert ValueOutOfRange();
        verifier = verifier_;
        minDeposit = minDeposit_;
        owner = msg.sender;
        zeros[0] = 0;
        for (uint256 level = 0; level < DEPTH; level++) {
            uint256[2] memory pair;
            pair[0] = zeros[level];
            pair[1] = zeros[level];
            zeros[level + 1] = PoseidonT3.hash(pair);
            filled[level] = zeros[level];
        }
        currentRoot = zeros[DEPTH];
        knownRoots[currentRoot] = true;
    }

    /// Binds this pool to one ERC-20. Native pools leave `assetToken` unset.
    /// Only the deployer can call it, and only before the first leaf.
    function bindToken(address token) external {
        if (msg.sender != owner) revert NotOwner();
        if (token == address(0) || assetToken != address(0) || nextIndex != 0) revert TokenMode();
        assetToken = token;
        assetId = uint256(uint160(token));
        emit TokenBound(token, assetId);
    }

    function setMessageVerifier(address verifier_) external {
        if (msg.sender != owner) revert NotOwner();
        if (verifier_ == address(0) || messageVerifier != address(0)) revert VerifierSet();
        messageVerifier = verifier_;
    }

    function deposit(uint256 blinding, uint256 rho, uint256 ownerPub) external payable nonReentrant returns (uint256 commitment) {
        if (assetToken != address(0)) revert TokenMode();
        if (msg.value < minDeposit || msg.value > type(uint64).max) revert ValueOutOfRange();
        _field(blinding);
        _field(rho);
        _field(ownerPub);
        uint256[6] memory preimage;
        preimage[0] = DOMAIN_COMMITMENT;
        preimage[1] = msg.value;
        preimage[2] = blinding;
        preimage[3] = rho;
        preimage[4] = ownerPub;
        preimage[5] = _assetTag(assetId, block.chainid);
        commitment = PoseidonT7.hash(preimage);
        uint256 index = nextIndex;
        _insert(commitment);
        emit Deposited(commitment, msg.value, currentRoot, index);
    }

    function depositToken(uint256 amount, uint256 blinding, uint256 rho, uint256 ownerPub)
        external
        nonReentrant
        returns (uint256 commitment)
    {
        if (assetToken == address(0)) revert TokenMode();
        if (amount < minDeposit || amount > type(uint64).max) revert ValueOutOfRange();
        _field(blinding);
        _field(rho);
        _field(ownerPub);
        if (!IERC20(assetToken).transferFrom(msg.sender, address(this), amount)) revert TokenMode();
        uint256[6] memory preimage;
        preimage[0] = DOMAIN_COMMITMENT;
        preimage[1] = amount;
        preimage[2] = blinding;
        preimage[3] = rho;
        preimage[4] = ownerPub;
        preimage[5] = _assetTag(assetId, block.chainid);
        commitment = PoseidonT7.hash(preimage);
        uint256 index = nextIndex;
        _insert(commitment);
        emit Deposited(commitment, amount, currentRoot, index);
    }

    /// Mints `commitment` after two transports have attested `(this chain, commitment, nullifier, amount)`.
    function mintAttested(bytes32 messageId, uint256 commitment, uint256 nullifier, uint256 amount) external nonReentrant {
        if (messageVerifier == address(0)) revert MessageRejected();
        if (amount == 0 || amount > type(uint64).max) revert ValueOutOfRange();
        _field(commitment);
        _field(nullifier);
        if (!IMessageVerifier(messageVerifier).verify(messageId, block.chainid, commitment, nullifier, amount)) {
            revert MessageRejected();
        }
        if (nullifiers[nullifier]) revert NullifierSpent();
        nullifiers[nullifier] = true;
        IMessageVerifier(messageVerifier).consume(messageId);
        uint256 index = nextIndex;
        _insert(commitment);
        emit Deposited(commitment, amount, currentRoot, index);
    }

    /// @dev pubSignals = [root, nullifier, commitmentOut1, commitmentOut2, withdrawAmount, relayerFee, extDataHash]
    function shieldedTransfer(
        uint256[2] calldata pA,
        uint256[2][2] calldata pB,
        uint256[2] calldata pC,
        uint256[7] calldata pubSignals,
        address payable recipient,
        address payable relayer
    ) external nonReentrant {
        uint256 root = pubSignals[0];
        uint256 nullifier = pubSignals[1];
        uint256 withdrawAmount = pubSignals[4];
        uint256 relayerFee = pubSignals[5];
        if (!knownRoots[root]) revert UnknownRoot();
        if (nullifiers[nullifier]) revert NullifierSpent();
        if (pubSignals[6] != _extDataHash(recipient, relayer, withdrawAmount, relayerFee)) revert ExtDataMismatch();
        if (!verifier.verifyProof(pA, pB, pC, pubSignals)) revert InvalidProof();
        nullifiers[nullifier] = true;
        _insert(pubSignals[2]);
        _insert(pubSignals[3]);
        _payout(recipient, withdrawAmount);
        _payout(relayer, relayerFee);
        emit Spent(nullifier, pubSignals[2], pubSignals[3], withdrawAmount, relayerFee, currentRoot);
    }

    function _insert(uint256 leaf) internal {
        if (nextIndex >= 2 ** DEPTH) revert TreeFull();
        uint256 index = nextIndex;
        uint256 current = leaf;
        for (uint256 level = 0; level < DEPTH; level++) {
            if (index % 2 == 0) {
                filled[level] = current;
                uint256[2] memory pair;
                pair[0] = current;
                pair[1] = zeros[level];
                current = PoseidonT3.hash(pair);
            } else {
                uint256[2] memory pair;
                pair[0] = filled[level];
                pair[1] = current;
                current = PoseidonT3.hash(pair);
            }
            index /= 2;
        }
        nextIndex += 1;
        currentRoot = current;
        knownRoots[current] = true;
    }

    /// Domain binder includes this pool's address, so the same proof cannot pay a different deployment.
    function _extDataHash(address recipient, address relayer, uint256 withdrawAmount, uint256 relayerFee)
        internal
        view
        returns (uint256)
    {
        uint256 recipientRaw = uint256(uint160(recipient));
        uint256 relayerRaw = uint256(uint160(relayer));
        uint256 poolRaw = uint256(uint160(address(this)));
        uint256[6] memory binder;
        binder[0] = DOMAIN_EXT;
        binder[1] = poolRaw & MASK128;
        binder[2] = poolRaw >> 128;
        binder[3] = block.chainid;
        binder[4] = withdrawAmount;
        binder[5] = relayerFee;
        uint256 bound = PoseidonT7.hash(binder);
        uint256[6] memory preimage;
        preimage[0] = recipientRaw & MASK128;
        preimage[1] = recipientRaw >> 128;
        preimage[2] = relayerRaw & MASK128;
        preimage[3] = relayerRaw >> 128;
        preimage[4] = bound;
        preimage[5] = 0;
        return PoseidonT7.hash(preimage);
    }

    function _assetTag(uint256 id, uint256 chainHome) internal pure returns (uint256) {
        uint256[2] memory assetPair;
        assetPair[0] = DOMAIN_ASSET;
        assetPair[1] = id;
        uint256[2] memory chainPair;
        chainPair[0] = DOMAIN_CHAIN;
        chainPair[1] = chainHome;
        uint256[2] memory packed;
        packed[0] = PoseidonT3.hash(assetPair);
        packed[1] = PoseidonT3.hash(chainPair);
        return PoseidonT3.hash(packed);
    }

    function _payout(address payable to, uint256 amount) internal {
        if (assetToken == address(0)) _pay(to, amount);
        else _payToken(to, amount);
    }

    function _payToken(address to, uint256 amount) internal {
        if (amount == 0) return;
        if (!IERC20(assetToken).transfer(to, amount)) revert TokenMode();
    }

    function _pay(address payable to, uint256 amount) internal {
        if (amount == 0) return;
        if (amount > address(this).balance) revert ValueOutOfRange();
        (bool ok,) = to.call{value: amount}("");
        require(ok, "payout failed");
    }

    function _field(uint256 value) internal pure {
        if (value >= FIELD) revert FieldOverflow();
    }
}

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IMessageVerifier {
    function verify(bytes32 messageId, uint256 destChain, uint256 commitment, uint256 nullifier, uint256 amount)
        external
        view
        returns (bool);
    function consume(bytes32 messageId) external;
}
