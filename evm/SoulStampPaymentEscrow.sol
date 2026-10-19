// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface ISoulStampUSDC {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title SoulStampPaymentEscrow
/// @notice Request-bound Arc Testnet USDC escrow for SoulStamp V4.
/// @dev The contract deliberately does not pretend to read GenLayer.  An
///      authorised settlement operator submits a settlement acknowledgement
///      only after independently verifying the finalised GenLayer assessment.
///      GenLayer V4 then independently verifies this contract's settlement
///      event before making the assessment consumable.
contract SoulStampPaymentEscrow {
    uint256 public constant ARC_CHAIN_ID = 5_042_002;
    uint256 public constant USDC_DECIMALS = 6;
    uint256 public constant ASSESSMENT_PRICE = 1_000_000;
    uint256 public constant REFUND_DELAY = 72 hours;
    uint8 public constant PAYMENT_NONE = 0;
    uint8 public constant PAYMENT_ESCROWED = 1;
    uint8 public constant PAYMENT_SETTLED = 2;
    uint8 public constant PAYMENT_REFUNDED = 3;
    string public constant VERSION = "soulstamp-v4-arc-usdc-escrow-1.0.0";

    ISoulStampUSDC public immutable usdc;
    /// @notice Bound exactly once after the GenLayer V4 address is deployed.
    /// @dev The one-time binding resolves the unavoidable Arc↔GenLayer deployment
    ///      ordering cycle without making payment intents mutable afterwards.
    address public genlayerV4;

    address public admin;
    address public pendingAdmin;
    address public treasury;
    address public pendingTreasury;
    address public settlementOperator;
    address public pendingSettlementOperator;

    bool public paused;
    uint256 public escrowedLiabilities;
    uint256 public earnedRevenue;
    uint256 public totalDeposited;
    uint256 public totalSettled;
    uint256 public totalRefunded;

    struct Payment {
        bytes32 requestId;
        address payer;
        address subject;
        bytes32 policyHash;
        uint256 amount;
        uint256 nonce;
        uint256 intentExpiry;
        uint256 depositedAt;
        uint8 status;
    }

    mapping(bytes32 => Payment) private _payments;
    mapping(bytes32 => bool) public usedIntentHashes;
    mapping(bytes32 => bool) public usedSettlementKeys;

    event PaymentDeposited(
        bytes32 indexed requestId,
        address indexed payer,
        address indexed subject,
        bytes32 policyHash,
        uint256 amount,
        uint256 intentExpiry,
        uint256 nonce
    );
    event PaymentSettled(
        bytes32 indexed requestId,
        bytes32 indexed assessmentId,
        address indexed subject,
        bytes32 policyHash,
        uint8 outcome,
        bytes32 resultCommitment
    );
    event PaymentRefunded(
        bytes32 indexed requestId, address indexed payer, address indexed subject, uint256 amount
    );
    event PriceChanged(uint256 oldPrice, uint256 newPrice);
    event TreasuryWithdrawal(address indexed treasury, uint256 amount);
    event AdminTransferProposed(address indexed currentAdmin, address indexed pendingAdmin);
    event AdminTransferred(address indexed previousAdmin, address indexed newAdmin);
    event TreasuryTransferProposed(
        address indexed currentTreasury, address indexed pendingTreasury
    );
    event TreasuryTransferred(address indexed previousTreasury, address indexed newTreasury);
    event SettlementOperatorChanged(address indexed previousOperator, address indexed newOperator);
    event SettlementOperatorTransferProposed(
        address indexed currentOperator, address indexed pendingOperator
    );
    event PaymentPauseChanged(bool paused);
    event GenLayerV4Configured(address indexed v4Contract);

    error Unauthorized();
    error InvalidAddress();
    error InvalidAmount();
    error InvalidIntent();
    error InvalidState();
    error IntentExpired();
    error Paused();
    error TransferFailed();
    error Reentrancy();
    error RefundNotAvailable();
    error SettlementMismatch();

    uint256 private _entered;

    modifier onlyAdmin() {
        if (msg.sender != admin) revert Unauthorized();
        _;
    }

    modifier onlyTreasury() {
        if (msg.sender != treasury) revert Unauthorized();
        _;
    }

    modifier onlySettlementOperator() {
        if (msg.sender != settlementOperator) revert Unauthorized();
        _;
    }

    modifier nonReentrant() {
        if (_entered == 1) revert Reentrancy();
        _entered = 1;
        _;
        _entered = 0;
    }

    constructor(
        address usdc_,
        address genlayerV4_,
        address admin_,
        address treasury_,
        address settlementOperator_
    ) {
        if (
            usdc_ == address(0) || admin_ == address(0) || treasury_ == address(0)
                || settlementOperator_ == address(0)
        ) revert InvalidAddress();
        usdc = ISoulStampUSDC(usdc_);
        genlayerV4 = genlayerV4_;
        admin = admin_;
        treasury = treasury_;
        settlementOperator = settlementOperator_;
    }

    /// @notice Bind the deployed V4 contract once, before any payment exists.
    /// @dev This is intentionally not a general setter: changing the address
    ///      would invalidate the domain separation of existing payment intents.
    function configureGenLayerV4(address v4Contract) external onlyAdmin {
        if (v4Contract == address(0) || genlayerV4 != address(0)) revert InvalidState();
        genlayerV4 = v4Contract;
        emit GenLayerV4Configured(v4Contract);
    }

    function price() external pure returns (uint256) {
        return ASSESSMENT_PRICE;
    }

    function quote(
        bytes32 requestId,
        address payer,
        address subject,
        bytes32 policyHash,
        uint256 nonce,
        uint256 intentExpiry
    ) external view returns (bytes32) {
        return intentHash(requestId, payer, subject, policyHash, nonce, intentExpiry);
    }

    function intentHash(
        bytes32 requestId,
        address payer,
        address subject,
        bytes32 policyHash,
        uint256 nonce,
        uint256 intentExpiry
    ) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("SOULSTAMP_V4_ARC_PAYMENT_INTENT"),
                ARC_CHAIN_ID,
                address(this),
                genlayerV4,
                requestId,
                payer,
                subject,
                policyHash,
                ASSESSMENT_PRICE,
                nonce,
                intentExpiry
            )
        );
    }

    function deposit(
        bytes32 requestId,
        address subject,
        bytes32 policyHash,
        uint256 nonce,
        uint256 intentExpiry
    ) external nonReentrant returns (bytes32 intent) {
        if (paused) revert Paused();
        if (genlayerV4 == address(0)) revert InvalidState();
        if (
            requestId == bytes32(0) || subject == address(0) || policyHash == bytes32(0)
                || nonce == 0
        ) {
            revert InvalidIntent();
        }
        if (intentExpiry <= block.timestamp || intentExpiry > block.timestamp + 30 minutes) {
            revert IntentExpired();
        }
        if (_payments[requestId].status != PAYMENT_NONE) revert InvalidState();
        intent = intentHash(requestId, msg.sender, subject, policyHash, nonce, intentExpiry);
        if (usedIntentHashes[intent]) revert InvalidIntent();
        usedIntentHashes[intent] = true;
        _safeTransferFrom(address(usdc), msg.sender, address(this), ASSESSMENT_PRICE);
        _payments[requestId] = Payment({
            requestId: requestId,
            payer: msg.sender,
            subject: subject,
            policyHash: policyHash,
            amount: ASSESSMENT_PRICE,
            nonce: nonce,
            intentExpiry: intentExpiry,
            depositedAt: block.timestamp,
            status: PAYMENT_ESCROWED
        });
        escrowedLiabilities += ASSESSMENT_PRICE;
        totalDeposited += ASSESSMENT_PRICE;
        emit PaymentDeposited(
            requestId, msg.sender, subject, policyHash, ASSESSMENT_PRICE, intentExpiry, nonce
        );
    }

    /// @notice Acknowledges a GenLayer result after an off-chain operator has
    /// verified its FINALIZED, successful execution and exact post-state.
    function settle(
        bytes32 requestId,
        bytes32 assessmentId,
        address subject,
        bytes32 policyHash,
        uint8 outcome,
        bytes32 resultCommitment
    ) external onlySettlementOperator nonReentrant {
        Payment storage payment = _payments[requestId];
        if (payment.status != PAYMENT_ESCROWED) revert InvalidState();
        if (block.timestamp > payment.depositedAt + REFUND_DELAY) revert RefundNotAvailable();
        if (
            assessmentId == bytes32(0) || resultCommitment == bytes32(0)
                || subject != payment.subject || policyHash != payment.policyHash || outcome < 1
                || outcome > 3
        ) revert SettlementMismatch();
        bytes32 key = keccak256(abi.encode(requestId, assessmentId, resultCommitment));
        if (usedSettlementKeys[key]) revert InvalidIntent();
        usedSettlementKeys[key] = true;
        payment.status = PAYMENT_SETTLED;
        escrowedLiabilities -= payment.amount;
        earnedRevenue += payment.amount;
        totalSettled += 1;
        emit PaymentSettled(requestId, assessmentId, subject, policyHash, outcome, resultCommitment);
    }

    /// @notice Permissionless timeout recovery. The only recipient is the
    /// original payer stored in the escrow record.
    function refund(bytes32 requestId) external nonReentrant {
        Payment storage payment = _payments[requestId];
        if (
            payment.status != PAYMENT_ESCROWED
                || block.timestamp < payment.depositedAt + REFUND_DELAY
        ) {
            revert RefundNotAvailable();
        }
        payment.status = PAYMENT_REFUNDED;
        escrowedLiabilities -= payment.amount;
        totalRefunded += 1;
        _safeTransfer(address(usdc), payment.payer, payment.amount);
        emit PaymentRefunded(requestId, payment.payer, payment.subject, payment.amount);
    }

    function getPayment(bytes32 requestId) external view returns (Payment memory) {
        return _payments[requestId];
    }

    function availableRevenue() public view returns (uint256) {
        uint256 balance = usdc.balanceOf(address(this));
        return balance < earnedRevenue ? balance : earnedRevenue;
    }

    function withdrawRevenue(uint256 amount) external onlyTreasury nonReentrant {
        if (amount == 0 || amount > availableRevenue()) revert InvalidAmount();
        earnedRevenue -= amount;
        _safeTransfer(address(usdc), treasury, amount);
        emit TreasuryWithdrawal(treasury, amount);
    }

    function setPaused(bool value) external onlyAdmin {
        paused = value;
        emit PaymentPauseChanged(value);
    }

    function proposeAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0) || newAdmin == admin) revert InvalidAddress();
        pendingAdmin = newAdmin;
        emit AdminTransferProposed(admin, newAdmin);
    }

    function cancelAdminTransfer() external onlyAdmin {
        pendingAdmin = address(0);
        emit AdminTransferProposed(admin, address(0));
    }

    function acceptAdmin() external {
        if (msg.sender != pendingAdmin) revert Unauthorized();
        address previous = admin;
        admin = msg.sender;
        pendingAdmin = address(0);
        emit AdminTransferred(previous, msg.sender);
    }

    function proposeTreasury(address newTreasury) external onlyAdmin {
        if (newTreasury == address(0) || newTreasury == treasury) revert InvalidAddress();
        pendingTreasury = newTreasury;
        emit TreasuryTransferProposed(treasury, newTreasury);
    }

    function cancelTreasuryTransfer() external onlyAdmin {
        pendingTreasury = address(0);
        emit TreasuryTransferProposed(treasury, address(0));
    }

    function acceptTreasury() external {
        if (msg.sender != pendingTreasury) revert Unauthorized();
        address previous = treasury;
        treasury = msg.sender;
        pendingTreasury = address(0);
        emit TreasuryTransferred(previous, msg.sender);
    }

    function proposeSettlementOperator(address newOperator) external onlyAdmin {
        if (newOperator == address(0) || newOperator == settlementOperator) {
            revert InvalidAddress();
        }
        pendingSettlementOperator = newOperator;
        emit SettlementOperatorTransferProposed(settlementOperator, newOperator);
    }

    function cancelSettlementOperatorTransfer() external onlyAdmin {
        pendingSettlementOperator = address(0);
        emit SettlementOperatorTransferProposed(settlementOperator, address(0));
    }

    function acceptSettlementOperator() external {
        if (msg.sender != pendingSettlementOperator) revert Unauthorized();
        address previous = settlementOperator;
        settlementOperator = msg.sender;
        pendingSettlementOperator = address(0);
        emit SettlementOperatorChanged(previous, msg.sender);
    }

    function liabilitiesSolvent() external view returns (bool) {
        return usdc.balanceOf(address(this)) >= escrowedLiabilities;
    }

    function _safeTransfer(address token, address to, uint256 amount) private {
        (bool ok, bytes memory data) =
            token.call(abi.encodeWithSelector(ISoulStampUSDC.transfer.selector, to, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) private {
        (bool ok, bytes memory data) = token.call(
            abi.encodeWithSelector(ISoulStampUSDC.transferFrom.selector, from, to, amount)
        );
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }
}
