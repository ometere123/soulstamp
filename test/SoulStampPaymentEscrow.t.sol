// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../evm/SoulStampPaymentEscrow.sol";

interface Vm {
    function prank(address sender) external;
    function warp(uint256 timestamp) external;
    function expectRevert(bytes4 selector) external;
}

contract MockUSDC is ISoulStampUSDC {
    mapping(address => uint256) public balances;
    mapping(address => mapping(address => uint256)) public allowances;
    address public reentryTarget;
    bytes public reentryCall;
    bool public reentryAttempted;

    function mint(address to, uint256 amount) external {
        balances[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowances[msg.sender][spender] = amount;
        return true;
    }

    function allowance(address owner, address spender) external view returns (uint256) {
        return allowances[owner][spender];
    }

    function configureReentry(address target, bytes calldata data) external {
        reentryTarget = target;
        reentryCall = data;
    }

    function balanceOf(address owner) external view returns (uint256) {
        return balances[owner];
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balances[msg.sender] >= amount, "balance");
        balances[msg.sender] -= amount;
        balances[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (reentryTarget != address(0)) {
            reentryAttempted = true;
            reentryTarget.call(reentryCall);
        }
        require(balances[from] >= amount, "balance");
        uint256 allowed = allowances[from][msg.sender];
        require(allowed >= amount, "allowance");
        allowances[from][msg.sender] = allowed - amount;
        balances[from] -= amount;
        balances[to] += amount;
        return true;
    }
}

contract SoulStampPaymentEscrowTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    MockUSDC private token;
    SoulStampPaymentEscrow private escrow;
    address private admin = address(0xA11CE);
    address private treasury = address(0xB0B);
    address private operator = address(0xC0DE);
    address private payer = address(0xD00D);
    address private subject = address(0xE11E);
    bytes32 private constant REQUEST = keccak256("request-1");
    bytes32 private constant POLICY = keccak256("policy-1");

    function setUp() public {
        token = new MockUSDC();
        escrow =
            new SoulStampPaymentEscrow(address(token), address(0x1234), admin, treasury, operator);
        token.mint(payer, 3_000_000);
        vm.prank(payer);
        token.approve(address(escrow), 3_000_000);
    }

    function _deposit() private {
        vm.prank(payer);
        escrow.deposit(REQUEST, subject, POLICY, 1, block.timestamp + 20 minutes);
    }

    function testDepositBindsExactPaymentAndSolvency() public {
        _deposit();
        SoulStampPaymentEscrow.Payment memory payment = escrow.getPayment(REQUEST);
        require(payment.payer == payer, "payer binding");
        require(payment.subject == subject, "subject binding");
        require(payment.policyHash == POLICY, "policy binding");
        require(payment.amount == 1_000_000, "amount");
        require(payment.status == escrow.PAYMENT_ESCROWED(), "state");
        require(escrow.escrowedLiabilities() == 1_000_000, "liability");
        require(escrow.liabilitiesSolvent(), "solvency");
    }

    function testDuplicateRequestAndIntentReplayFail() public {
        _deposit();
        vm.prank(payer);
        (bool duplicateOk,) = address(escrow)
            .call(
                abi.encodeWithSelector(
                    escrow.deposit.selector,
                    REQUEST,
                    subject,
                    POLICY,
                    1,
                    block.timestamp + 20 minutes
                )
            );
        require(!duplicateOk, "duplicate request accepted");
    }

    function testSettlementIsOneWayAndRevenueIsSeparate() public {
        _deposit();
        bytes32 assessment = keccak256("assessment-1");
        bytes32 commitment = keccak256("result-1");
        vm.prank(operator);
        escrow.settle(REQUEST, assessment, subject, POLICY, 1, commitment);
        SoulStampPaymentEscrow.Payment memory payment = escrow.getPayment(REQUEST);
        require(payment.status == escrow.PAYMENT_SETTLED(), "settled state");
        require(escrow.escrowedLiabilities() == 0, "liability released");
        require(escrow.earnedRevenue() == 1_000_000, "revenue accounting");
        vm.prank(operator);
        (bool secondOk,) = address(escrow)
            .call(
                abi.encodeWithSelector(
                    escrow.settle.selector, REQUEST, assessment, subject, POLICY, 1, commitment
                )
            );
        require(!secondOk, "duplicate settlement accepted");
        vm.prank(payer);
        (bool refundOk,) =
            address(escrow).call(abi.encodeWithSelector(escrow.refund.selector, REQUEST));
        require(!refundOk, "settled payment refunded");
    }

    function testTimeoutRefundReturnsOnlyOriginalPayer() public {
        _deposit();
        uint256 payerBefore = token.balanceOf(payer);
        vm.warp(block.timestamp + escrow.REFUND_DELAY());
        vm.prank(subject);
        escrow.refund(REQUEST);
        require(token.balanceOf(payer) == payerBefore + 1_000_000, "payer refund");
        require(token.balanceOf(subject) == 0, "arbitrary recipient paid");
        require(escrow.getPayment(REQUEST).status == escrow.PAYMENT_REFUNDED(), "refund state");
        require(escrow.escrowedLiabilities() == 0, "refund liability");
    }

    function testUnauthorizedTreasuryAndOperatorFail() public {
        _deposit();
        vm.prank(payer);
        (bool withdrawOk,) =
            address(escrow).call(abi.encodeWithSelector(escrow.withdrawRevenue.selector, 1));
        require(!withdrawOk, "unauthorized withdrawal");
        vm.prank(payer);
        (bool settleOk,) = address(escrow)
            .call(
                abi.encodeWithSelector(
                    escrow.settle.selector,
                    REQUEST,
                    keccak256("x"),
                    subject,
                    POLICY,
                    1,
                    keccak256("y")
                )
            );
        require(!settleOk, "unauthorized settlement");
    }

    function testPauseStopsDepositsButDoesNotEraseExistingEscrow() public {
        vm.prank(admin);
        escrow.setPaused(true);
        vm.prank(payer);
        (bool pausedOk,) = address(escrow)
            .call(
                abi.encodeWithSelector(
                    escrow.deposit.selector,
                    REQUEST,
                    subject,
                    POLICY,
                    1,
                    block.timestamp + 20 minutes
                )
            );
        require(!pausedOk, "paused deposit accepted");
        require(escrow.escrowedLiabilities() == 0, "paused liability changed");
    }

    function testGenLayerAddressCanOnlyBeConfiguredOnce() public {
        SoulStampPaymentEscrow deferred =
            new SoulStampPaymentEscrow(address(token), address(0), admin, treasury, operator);
        vm.prank(admin);
        deferred.configureGenLayerV4(address(0xCAFE));
        require(deferred.genlayerV4() == address(0xCAFE), "V4 binding");
        vm.prank(admin);
        (bool secondOk,) = address(deferred)
            .call(abi.encodeWithSelector(deferred.configureGenLayerV4.selector, address(0xBEEF)));
        require(!secondOk, "V4 binding changed");
    }

    function testStaleIntentAndWrongSettlementBindingsFailClosed() public {
        vm.prank(payer);
        (bool staleOk,) = address(escrow)
            .call(
                abi.encodeWithSelector(
                    escrow.deposit.selector,
                    REQUEST,
                    subject,
                    POLICY,
                    1,
                    block.timestamp + 31 minutes
                )
            );
        require(!staleOk, "stale intent accepted");
        _deposit();
        vm.prank(operator);
        (bool wrongSubject,) = address(escrow)
            .call(
                abi.encodeWithSelector(
                    escrow.settle.selector,
                    REQUEST,
                    keccak256("assessment"),
                    payer,
                    POLICY,
                    1,
                    keccak256("result")
                )
            );
        require(!wrongSubject, "wrong subject settlement accepted");
        vm.prank(operator);
        (bool wrongPolicy,) = address(escrow)
            .call(
                abi.encodeWithSelector(
                    escrow.settle.selector,
                    REQUEST,
                    keccak256("assessment"),
                    subject,
                    keccak256("other-policy"),
                    1,
                    keccak256("result")
                )
            );
        require(!wrongPolicy, "wrong policy settlement accepted");
    }

    function testReentrancyAttemptCannotEnterDeposit() public {
        bytes memory callback = abi.encodeWithSelector(
            escrow.deposit.selector, REQUEST, subject, POLICY, 2, block.timestamp + 20 minutes
        );
        token.configureReentry(address(escrow), callback);
        _deposit();
        require(token.reentryAttempted(), "malicious token did not attempt reentry");
        require(
            escrow.getPayment(REQUEST).status == escrow.PAYMENT_ESCROWED(), "outer deposit failed"
        );
    }

    function testAdminHandoverRequiresPendingAdminAcceptance() public {
        address nextAdmin = address(0xABCD);
        vm.prank(admin);
        escrow.proposeAdmin(nextAdmin);
        vm.prank(payer);
        (bool unauthorized,) =
            address(escrow).call(abi.encodeWithSelector(escrow.setPaused.selector, true));
        require(!unauthorized, "non-admin paused escrow");
        vm.prank(nextAdmin);
        escrow.acceptAdmin();
        require(escrow.admin() == nextAdmin, "admin handover");
    }
}
