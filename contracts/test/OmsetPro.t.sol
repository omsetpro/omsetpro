// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import {OmsetPro} from "../src/OmsetPro.sol";

contract ReentrantParticipant {
    OmsetPro private immutable _omsetPro;
    bytes private _reentryCall;

    bool public rejectTransfers;
    bool public reentryAttempted;
    bool public reentrySucceeded;
    bytes4 public reentryError;

    constructor(OmsetPro omsetPro_) {
        _omsetPro = omsetPro_;
    }

    function execute(bytes calldata callData) external payable returns (bytes memory result) {
        (bool success, bytes memory returnData) = address(_omsetPro).call{value: msg.value}(callData);
        if (!success) {
            assembly ("memory-safe") {
                revert(add(returnData, 0x20), mload(returnData))
            }
        }
        return returnData;
    }

    function configureReentry(bytes calldata callData) external {
        _reentryCall = callData;
        reentryAttempted = false;
        reentrySucceeded = false;
        reentryError = bytes4(0);
    }

    function setRejectTransfers(bool shouldReject) external {
        rejectTransfers = shouldReject;
    }

    receive() external payable {
        if (rejectTransfers) revert();
        if (_reentryCall.length != 0 && !reentryAttempted) {
            reentryAttempted = true;
            bytes memory callData = _reentryCall;
            bytes memory returnData;
            (reentrySucceeded, returnData) = address(_omsetPro).call(callData);
            if (returnData.length >= 4) {
                bytes4 selector;
                assembly ("memory-safe") {
                    selector := mload(add(returnData, 0x20))
                }
                reentryError = selector;
            }
        }
    }
}

contract FeeRecipientProbe {
    OmsetPro public target;
    bytes private _reentryCall;
    bool public rejectTransfers;
    bool public reentryAttempted;
    bool public reentrySucceeded;
    bytes4 public reentryError;

    function configure(OmsetPro target_, bytes calldata reentryCall_) external {
        target = target_;
        _reentryCall = reentryCall_;
    }

    function setRejectTransfers(bool reject) external {
        rejectTransfers = reject;
    }

    receive() external payable {
        if (rejectTransfers) revert();
        if (address(target) != address(0) && !reentryAttempted) {
            reentryAttempted = true;
            bytes memory returnData;
            (reentrySucceeded, returnData) = address(target).call(_reentryCall);
            if (returnData.length >= 4) {
                bytes4 selector;
                assembly ("memory-safe") {
                    selector := mload(add(returnData, 0x20))
                }
                reentryError = selector;
            }
        }
    }
}

contract OmsetProTest is Test {
    OmsetPro private omsetPro;

    address private constant OWNER = address(0xA11CE);
    address private constant BORROWER = address(0xB0B);
    address private constant ARBITER = address(0xA4B17E4);
    address private constant OUTSIDER = address(0xBAD);
    address private constant FEE_RECIPIENT = address(0xFEE);

    uint256 private constant DEPOSIT = 10 ether;
    uint64 private constant INSPECTION_PERIOD = 2 days;
    uint64 private constant CLAIM_RESPONSE_PERIOD = 1 days;
    string private constant ITEM_NAME = "Camera";
    string private constant ITEM_METADATA_URI = "ipfs://camera-metadata";
    string private constant RETURN_PROOF_URI = "ipfs://return-proof";
    string private constant CLAIM_EVIDENCE_URI = "ipfs://damage-evidence";

    uint64 private handoverDeadline;
    uint64 private returnDeadline;

    event AgreementCreated(
        uint256 indexed agreementId,
        address indexed owner,
        address indexed borrower,
        address arbiter,
        uint256 depositAmount
    );
    event AgreementCancelled(
        uint256 indexed agreementId, address indexed owner, address indexed actor, bool depositRefunded
    );
    event AgreementFunded(
        uint256 indexed agreementId, address indexed borrower, uint256 amount, uint64 fundingTimestamp
    );
    event ProtocolFeeCollected(
        uint256 indexed agreementId, address indexed payer, address indexed feeRecipient, uint256 feeAmount
    );
    event HandoverConfirmed(uint256 indexed agreementId, address indexed owner, uint64 handoverTimestamp);
    event ReturnRequested(
        uint256 indexed agreementId, address indexed borrower, string returnProofURI, uint64 returnRequestTimestamp
    );
    event ReturnConfirmed(
        uint256 indexed agreementId,
        address indexed actor,
        address indexed borrower,
        uint256 refundedAmount,
        bool timedOut
    );
    event ClaimRaised(
        uint256 indexed agreementId,
        address indexed owner,
        uint256 claimAmount,
        string claimEvidenceURI,
        bool overdue,
        uint64 claimCreationTimestamp
    );
    event ClaimDisputed(uint256 indexed agreementId, address indexed borrower, address indexed arbiter);
    event ClaimAccepted(
        uint256 indexed agreementId,
        address indexed borrower,
        address indexed owner,
        uint256 ownerAward,
        uint256 borrowerRefund
    );
    event ClaimFinalized(
        uint256 indexed agreementId,
        address indexed owner,
        address indexed borrower,
        uint256 ownerAward,
        uint256 borrowerRefund
    );
    event DisputeResolved(
        uint256 indexed agreementId,
        address indexed arbiter,
        address indexed owner,
        address borrower,
        uint256 ownerAward,
        uint256 borrowerRefund
    );

    function setUp() external {
        vm.warp(1_000_000);
        omsetPro = new OmsetPro(FEE_RECIPIENT);
        handoverDeadline = uint64(block.timestamp + 1 days);
        returnDeadline = uint64(block.timestamp + 7 days);
        vm.deal(OWNER, 1_000 ether);
        vm.deal(BORROWER, 1_000 ether);
    }

    function testConstructorStoresFeeRecipientAndRejectsZeroAddress() external {
        assertEq(omsetPro.feeRecipient(), FEE_RECIPIENT);
        vm.expectRevert(OmsetPro.ZeroAddress.selector);
        new OmsetPro(address(0));
    }

    function testProtocolFeeHelpers() external view {
        assertEq(omsetPro.PROTOCOL_FEE_BPS(), 100);
        assertEq(omsetPro.BPS_DENOMINATOR(), 10_000);
        assertEq(omsetPro.protocolFeeFor(100 ether), 1 ether);
        assertEq(omsetPro.totalFundingRequired(100 ether), 101 ether);
        assertEq(omsetPro.protocolFeeFor(1), 0);
    }

    function testCreateAgreementStoresDataEmitsEventAndIndexesRoles() external {
        vm.expectEmit(true, true, true, true);
        emit AgreementCreated(1, OWNER, BORROWER, ARBITER, DEPOSIT);
        uint256 agreementId = _createAgreement();

        OmsetPro.Agreement memory agreement = omsetPro.getAgreement(agreementId);
        assertEq(agreement.id, 1);
        assertEq(agreement.owner, OWNER);
        assertEq(agreement.borrower, BORROWER);
        assertEq(agreement.arbiter, ARBITER);
        assertEq(agreement.itemName, ITEM_NAME);
        assertEq(agreement.itemMetadataURI, ITEM_METADATA_URI);
        assertEq(agreement.depositAmount, DEPOSIT);
        assertEq(agreement.handoverDeadline, handoverDeadline);
        assertEq(agreement.returnDeadline, returnDeadline);
        assertEq(agreement.inspectionPeriod, INSPECTION_PERIOD);
        assertEq(agreement.claimResponsePeriod, CLAIM_RESPONSE_PERIOD);
        assertEq(uint256(agreement.status), uint256(OmsetPro.Status.Created));
        assertEq(omsetPro.totalAgreementCount(), 1);
        assertEq(omsetPro.getOwnerAgreementIds(OWNER), _singleId(1));
        assertEq(omsetPro.getBorrowerAgreementIds(BORROWER), _singleId(1));
        assertEq(omsetPro.getArbiterAgreementIds(ARBITER), _singleId(1));
    }

    function testAgreementIdsAreUniqueAndSequential() external {
        assertEq(_createAgreement(), 1);
        assertEq(_createAgreement(), 2);
        assertEq(omsetPro.totalAgreementCount(), 2);
    }

    function testGetUnknownAgreementReverts() external {
        vm.expectRevert(abi.encodeWithSelector(OmsetPro.AgreementNotFound.selector, 99));
        omsetPro.getAgreement(99);
    }

    function testCreateRejectsZeroBorrower() external {
        _expectCreateRevert(
            OmsetPro.ZeroAddress.selector,
            address(0),
            ARBITER,
            ITEM_NAME,
            ITEM_METADATA_URI,
            DEPOSIT,
            handoverDeadline,
            returnDeadline,
            INSPECTION_PERIOD,
            CLAIM_RESPONSE_PERIOD
        );
    }

    function testCreateRejectsZeroArbiter() external {
        _expectCreateRevert(
            OmsetPro.ZeroAddress.selector,
            BORROWER,
            address(0),
            ITEM_NAME,
            ITEM_METADATA_URI,
            DEPOSIT,
            handoverDeadline,
            returnDeadline,
            INSPECTION_PERIOD,
            CLAIM_RESPONSE_PERIOD
        );
    }

    function testCreateRejectsOwnerAsBorrower() external {
        _expectCreateRevert(
            OmsetPro.RolesMustBeDistinct.selector,
            OWNER,
            ARBITER,
            ITEM_NAME,
            ITEM_METADATA_URI,
            DEPOSIT,
            handoverDeadline,
            returnDeadline,
            INSPECTION_PERIOD,
            CLAIM_RESPONSE_PERIOD
        );
    }

    function testCreateRejectsOwnerAsArbiter() external {
        _expectCreateRevert(
            OmsetPro.RolesMustBeDistinct.selector,
            BORROWER,
            OWNER,
            ITEM_NAME,
            ITEM_METADATA_URI,
            DEPOSIT,
            handoverDeadline,
            returnDeadline,
            INSPECTION_PERIOD,
            CLAIM_RESPONSE_PERIOD
        );
    }

    function testCreateRejectsBorrowerAsArbiter() external {
        _expectCreateRevert(
            OmsetPro.RolesMustBeDistinct.selector,
            BORROWER,
            BORROWER,
            ITEM_NAME,
            ITEM_METADATA_URI,
            DEPOSIT,
            handoverDeadline,
            returnDeadline,
            INSPECTION_PERIOD,
            CLAIM_RESPONSE_PERIOD
        );
    }

    function testCreateRejectsZeroDeposit() external {
        _expectCreateRevert(
            OmsetPro.ZeroDeposit.selector,
            BORROWER,
            ARBITER,
            ITEM_NAME,
            ITEM_METADATA_URI,
            0,
            handoverDeadline,
            returnDeadline,
            INSPECTION_PERIOD,
            CLAIM_RESPONSE_PERIOD
        );
    }

    function testCreateRejectsPastOrCurrentHandoverDeadline() external {
        _expectCreateRevert(
            OmsetPro.InvalidHandoverDeadline.selector,
            BORROWER,
            ARBITER,
            ITEM_NAME,
            ITEM_METADATA_URI,
            DEPOSIT,
            uint64(block.timestamp),
            returnDeadline,
            INSPECTION_PERIOD,
            CLAIM_RESPONSE_PERIOD
        );
    }

    function testCreateRejectsReturnDeadlineNotAfterHandover() external {
        _expectCreateRevert(
            OmsetPro.InvalidReturnDeadline.selector,
            BORROWER,
            ARBITER,
            ITEM_NAME,
            ITEM_METADATA_URI,
            DEPOSIT,
            handoverDeadline,
            handoverDeadline,
            INSPECTION_PERIOD,
            CLAIM_RESPONSE_PERIOD
        );
    }

    function testCreateRejectsZeroInspectionPeriod() external {
        _expectCreateRevert(
            OmsetPro.ZeroInspectionPeriod.selector,
            BORROWER,
            ARBITER,
            ITEM_NAME,
            ITEM_METADATA_URI,
            DEPOSIT,
            handoverDeadline,
            returnDeadline,
            0,
            CLAIM_RESPONSE_PERIOD
        );
    }

    function testCreateRejectsZeroClaimResponsePeriod() external {
        _expectCreateRevert(
            OmsetPro.ZeroClaimResponsePeriod.selector,
            BORROWER,
            ARBITER,
            ITEM_NAME,
            ITEM_METADATA_URI,
            DEPOSIT,
            handoverDeadline,
            returnDeadline,
            INSPECTION_PERIOD,
            0
        );
    }

    function testCreateRejectsEmptyItemName() external {
        _expectCreateRevert(
            OmsetPro.EmptyItemName.selector,
            BORROWER,
            ARBITER,
            "",
            ITEM_METADATA_URI,
            DEPOSIT,
            handoverDeadline,
            returnDeadline,
            INSPECTION_PERIOD,
            CLAIM_RESPONSE_PERIOD
        );
    }

    function testCreateRejectsEmptyMetadataURI() external {
        _expectCreateRevert(
            OmsetPro.EmptyMetadataURI.selector,
            BORROWER,
            ARBITER,
            ITEM_NAME,
            "",
            DEPOSIT,
            handoverDeadline,
            returnDeadline,
            INSPECTION_PERIOD,
            CLAIM_RESPONSE_PERIOD
        );
    }

    function testOwnerCanCancelUnfundedAgreement() external {
        uint256 agreementId = _createAgreement();
        vm.expectEmit(true, true, true, true);
        emit AgreementCancelled(agreementId, OWNER, OWNER, false);
        vm.prank(OWNER);
        omsetPro.cancelAgreement(agreementId);
        _assertStatus(agreementId, OmsetPro.Status.Cancelled);
    }

    function testOnlyOwnerCanCancelAndFundedAgreementCannotBeCancelled() external {
        uint256 agreementId = _createAgreement();
        _expectUnauthorized(agreementId, OUTSIDER);
        vm.prank(OUTSIDER);
        omsetPro.cancelAgreement(agreementId);

        _fund(agreementId, DEPOSIT, BORROWER);
        _expectStatus(agreementId, OmsetPro.Status.Created, OmsetPro.Status.Funded);
        vm.prank(OWNER);
        omsetPro.cancelAgreement(agreementId);
    }

    function testBorrowerFundsDepositPlusFeeOnce() external {
        uint256 agreementId = _createAgreement();
        uint256 fee = omsetPro.protocolFeeFor(DEPOSIT);
        uint256 feeRecipientBefore = FEE_RECIPIENT.balance;
        vm.expectEmit(true, true, false, true);
        emit AgreementFunded(agreementId, BORROWER, DEPOSIT, uint64(block.timestamp));
        vm.expectEmit(true, true, true, true);
        emit ProtocolFeeCollected(agreementId, BORROWER, FEE_RECIPIENT, fee);
        _fund(agreementId, DEPOSIT, BORROWER);

        OmsetPro.Agreement memory agreement = omsetPro.getAgreement(agreementId);
        assertEq(uint256(agreement.status), uint256(OmsetPro.Status.Funded));
        assertEq(agreement.fundingTimestamp, block.timestamp);
        assertEq(address(omsetPro).balance, DEPOSIT);
        assertEq(FEE_RECIPIENT.balance - feeRecipientBefore, fee);

        _expectStatus(agreementId, OmsetPro.Status.Created, OmsetPro.Status.Funded);
        _fund(agreementId, DEPOSIT, BORROWER);
    }

    function testBorrowerCanFundOneSecondBeforeHandoverDeadline() external {
        uint256 agreementId = _createAgreement();
        vm.warp(uint256(handoverDeadline) - 1);

        _fund(agreementId, DEPOSIT, BORROWER);

        _assertStatus(agreementId, OmsetPro.Status.Funded);
        assertEq(address(omsetPro).balance, DEPOSIT);
    }

    function testFundingAtHandoverDeadlineRevertsWithoutChangingStateOrBalance() external {
        uint256 agreementId = _createAgreement();
        uint256 balanceBefore = address(omsetPro).balance;
        vm.warp(handoverDeadline);

        vm.expectRevert(abi.encodeWithSelector(OmsetPro.DeadlineExpired.selector, agreementId, handoverDeadline));
        _fund(agreementId, DEPOSIT, BORROWER);

        _assertStatus(agreementId, OmsetPro.Status.Created);
        assertEq(address(omsetPro).balance, balanceBefore);
    }

    function testFundingAfterHandoverDeadlineRevertsWithoutChangingStateOrBalance() external {
        uint256 agreementId = _createAgreement();
        uint256 balanceBefore = address(omsetPro).balance;
        vm.warp(uint256(handoverDeadline) + 1);

        vm.expectRevert(abi.encodeWithSelector(OmsetPro.DeadlineExpired.selector, agreementId, handoverDeadline));
        _fund(agreementId, DEPOSIT, BORROWER);

        _assertStatus(agreementId, OmsetPro.Status.Created);
        assertEq(address(omsetPro).balance, balanceBefore);
    }

    function testFundingRejectsWrongRoleAndIncorrectAmounts() external {
        uint256 agreementId = _createAgreement();
        uint256 total = omsetPro.totalFundingRequired(DEPOSIT);
        _expectUnauthorized(agreementId, OWNER);
        _fund(agreementId, DEPOSIT, OWNER);

        vm.expectRevert(abi.encodeWithSelector(OmsetPro.IncorrectDeposit.selector, total, DEPOSIT));
        _fundValue(agreementId, DEPOSIT, BORROWER);
        vm.expectRevert(abi.encodeWithSelector(OmsetPro.IncorrectDeposit.selector, total, total - 1));
        _fundValue(agreementId, total - 1, BORROWER);
        vm.expectRevert(abi.encodeWithSelector(OmsetPro.IncorrectDeposit.selector, total, total + 1));
        _fundValue(agreementId, total + 1, BORROWER);
        _assertStatus(agreementId, OmsetPro.Status.Created);
        assertEq(FEE_RECIPIENT.balance, 0);
    }

    function testRejectedFeeTransferRevertsFundingAndPreservesBalances() external {
        FeeRecipientProbe recipient = new FeeRecipientProbe();
        recipient.setRejectTransfers(true);
        OmsetPro contractWithRecipient = new OmsetPro(address(recipient));
        omsetPro = contractWithRecipient;
        uint256 agreementId = _createAgreement();
        uint256 total = omsetPro.totalFundingRequired(DEPOSIT);
        uint256 borrowerBefore = BORROWER.balance;

        vm.expectRevert(
            abi.encodeWithSelector(OmsetPro.NativeTransferFailed.selector, address(recipient), total - DEPOSIT)
        );
        _fundValue(agreementId, total, BORROWER);

        _assertStatus(agreementId, OmsetPro.Status.Created);
        assertEq(omsetPro.getAgreement(agreementId).fundingTimestamp, 0);
        assertEq(address(omsetPro).balance, 0);
        assertEq(address(recipient).balance, 0);
        assertEq(BORROWER.balance, borrowerBefore);
    }

    function testFeeRecipientCannotReenterFunding() external {
        FeeRecipientProbe recipient = new FeeRecipientProbe();
        omsetPro = new OmsetPro(address(recipient));
        uint256 agreementId = _createAgreement();
        recipient.configure(omsetPro, abi.encodeCall(OmsetPro.fundAgreement, (agreementId)));

        _fund(agreementId, DEPOSIT, BORROWER);

        assertTrue(recipient.reentryAttempted());
        assertFalse(recipient.reentrySucceeded());
        assertEq(recipient.reentryError(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(address(recipient).balance, omsetPro.protocolFeeFor(DEPOSIT));
        assertEq(address(omsetPro).balance, DEPOSIT);
        _assertStatus(agreementId, OmsetPro.Status.Funded);
    }

    function testFeeRecipientOwnerCannotConfirmHandoverDuringFunding() external {
        FeeRecipientProbe recipient = new FeeRecipientProbe();
        omsetPro = new OmsetPro(address(recipient));
        vm.prank(address(recipient));
        uint256 agreementId = omsetPro.createAgreement(
            BORROWER,
            ARBITER,
            ITEM_NAME,
            ITEM_METADATA_URI,
            DEPOSIT,
            handoverDeadline,
            returnDeadline,
            INSPECTION_PERIOD,
            CLAIM_RESPONSE_PERIOD
        );
        recipient.configure(omsetPro, abi.encodeCall(OmsetPro.confirmHandover, (agreementId)));

        _fund(agreementId, DEPOSIT, BORROWER);

        assertTrue(recipient.reentryAttempted());
        assertFalse(recipient.reentrySucceeded());
        assertEq(recipient.reentryError(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        _assertStatus(agreementId, OmsetPro.Status.Funded);
    }

    function testOwnerConfirmsHandoverBeforeDeadline() external {
        uint256 agreementId = _fundedAgreement();
        vm.expectEmit(true, true, false, true);
        emit HandoverConfirmed(agreementId, OWNER, uint64(block.timestamp));
        vm.prank(OWNER);
        omsetPro.confirmHandover(agreementId);
        OmsetPro.Agreement memory agreement = omsetPro.getAgreement(agreementId);
        assertEq(uint256(agreement.status), uint256(OmsetPro.Status.Active));
        assertEq(agreement.handoverTimestamp, block.timestamp);
    }

    function testHandoverRejectsWrongRoleInvalidStatusAndDeadlineBoundary() external {
        uint256 agreementId = _fundedAgreement();
        uint256 createdId = _createAgreement();
        _expectUnauthorized(agreementId, BORROWER);
        vm.prank(BORROWER);
        omsetPro.confirmHandover(agreementId);

        vm.warp(handoverDeadline);
        vm.expectRevert(abi.encodeWithSelector(OmsetPro.DeadlineExpired.selector, agreementId, handoverDeadline));
        vm.prank(OWNER);
        omsetPro.confirmHandover(agreementId);

        _expectStatus(createdId, OmsetPro.Status.Funded, OmsetPro.Status.Created);
        vm.prank(OWNER);
        omsetPro.confirmHandover(createdId);
    }

    function testBorrowerRefundsMissedHandoverAtDeadline() external {
        uint256 agreementId = _fundedAgreement();
        uint256 balanceBefore = BORROWER.balance;
        vm.warp(handoverDeadline);
        vm.expectEmit(true, true, true, true);
        emit AgreementCancelled(agreementId, OWNER, BORROWER, true);
        vm.prank(BORROWER);
        omsetPro.refundUnhandedAgreement(agreementId);
        assertEq(BORROWER.balance, balanceBefore + DEPOSIT);
        assertEq(address(omsetPro).balance, 0);
        _assertStatus(agreementId, OmsetPro.Status.Cancelled);
    }

    function testMissedHandoverRefundRejectsWrongRoleAndEarlyCall() external {
        uint256 agreementId = _fundedAgreement();
        _expectUnauthorized(agreementId, OWNER);
        vm.prank(OWNER);
        omsetPro.refundUnhandedAgreement(agreementId);

        vm.expectRevert(abi.encodeWithSelector(OmsetPro.DeadlineNotReached.selector, agreementId, handoverDeadline));
        vm.prank(BORROWER);
        omsetPro.refundUnhandedAgreement(agreementId);
    }

    function testBorrowerRequestsReturnWithProof() external {
        uint256 agreementId = _activeAgreement();
        vm.expectEmit(true, true, false, true);
        emit ReturnRequested(agreementId, BORROWER, RETURN_PROOF_URI, uint64(block.timestamp));
        vm.prank(BORROWER);
        omsetPro.requestReturn(agreementId, RETURN_PROOF_URI);
        OmsetPro.Agreement memory agreement = omsetPro.getAgreement(agreementId);
        assertEq(uint256(agreement.status), uint256(OmsetPro.Status.ReturnRequested));
        assertEq(agreement.returnRequestTimestamp, block.timestamp);
        assertEq(agreement.returnProofURI, RETURN_PROOF_URI);
    }

    function testReturnRequestRejectsWrongRoleEmptyProofAndInvalidStatus() external {
        uint256 agreementId = _activeAgreement();
        _expectUnauthorized(agreementId, OWNER);
        vm.prank(OWNER);
        omsetPro.requestReturn(agreementId, RETURN_PROOF_URI);

        vm.expectRevert(OmsetPro.EmptyReturnProofURI.selector);
        vm.prank(BORROWER);
        omsetPro.requestReturn(agreementId, "");

        uint256 fundedId = _fundedAgreement();
        _expectStatus(fundedId, OmsetPro.Status.Active, OmsetPro.Status.Funded);
        vm.prank(BORROWER);
        omsetPro.requestReturn(fundedId, RETURN_PROOF_URI);
    }

    function testOwnerConfirmsSuccessfulReturnAndRefundsDeposit() external {
        uint256 agreementId = _returnRequestedAgreement();
        uint256 balanceBefore = BORROWER.balance;
        vm.expectEmit(true, true, true, true);
        emit ReturnConfirmed(agreementId, OWNER, BORROWER, DEPOSIT, false);
        vm.prank(OWNER);
        omsetPro.confirmSuccessfulReturn(agreementId);
        assertEq(BORROWER.balance, balanceBefore + DEPOSIT);
        _assertStatus(agreementId, OmsetPro.Status.Refunded);
    }

    function testSuccessfulReturnRejectsWrongRoleAndInspectionDeadlineBoundary() external {
        uint256 agreementId = _returnRequestedAgreement();
        _expectUnauthorized(agreementId, BORROWER);
        vm.prank(BORROWER);
        omsetPro.confirmSuccessfulReturn(agreementId);

        vm.warp(block.timestamp + INSPECTION_PERIOD);
        vm.expectRevert(abi.encodeWithSelector(OmsetPro.DeadlineExpired.selector, agreementId, block.timestamp));
        vm.prank(OWNER);
        omsetPro.confirmSuccessfulReturn(agreementId);
    }

    function testBorrowerFinalizesUnansweredReturnAtInspectionDeadline() external {
        uint256 agreementId = _returnRequestedAgreement();
        uint256 balanceBefore = BORROWER.balance;
        vm.warp(block.timestamp + INSPECTION_PERIOD);
        vm.expectEmit(true, true, true, true);
        emit ReturnConfirmed(agreementId, BORROWER, BORROWER, DEPOSIT, true);
        vm.prank(BORROWER);
        omsetPro.finalizeUnansweredReturn(agreementId);
        assertEq(BORROWER.balance, balanceBefore + DEPOSIT);
        _assertStatus(agreementId, OmsetPro.Status.Refunded);
    }

    function testUnansweredReturnFinalizationRejectsWrongRoleAndEarlyCall() external {
        uint256 agreementId = _returnRequestedAgreement();
        _expectUnauthorized(agreementId, OWNER);
        vm.prank(OWNER);
        omsetPro.finalizeUnansweredReturn(agreementId);

        uint256 deadline = block.timestamp + INSPECTION_PERIOD;
        vm.expectRevert(abi.encodeWithSelector(OmsetPro.DeadlineNotReached.selector, agreementId, deadline));
        vm.prank(BORROWER);
        omsetPro.finalizeUnansweredReturn(agreementId);
    }

    function testOwnerRaisesPartialDamageClaim() external {
        uint256 agreementId = _returnRequestedAgreement();
        uint256 claimAmount = 4 ether;
        vm.expectEmit(true, true, false, true);
        emit ClaimRaised(agreementId, OWNER, claimAmount, CLAIM_EVIDENCE_URI, false, uint64(block.timestamp));
        vm.prank(OWNER);
        omsetPro.raiseDamageClaim(agreementId, claimAmount, CLAIM_EVIDENCE_URI);
        _assertClaim(agreementId, claimAmount, false);
    }

    function testDamageClaimRejectsWrongRoleInvalidAmountEmptyEvidenceAndExpiredWindow() external {
        uint256 agreementId = _returnRequestedAgreement();
        _expectUnauthorized(agreementId, BORROWER);
        vm.prank(BORROWER);
        omsetPro.raiseDamageClaim(agreementId, 1 ether, CLAIM_EVIDENCE_URI);

        vm.expectRevert(abi.encodeWithSelector(OmsetPro.InvalidClaimAmount.selector, 0, DEPOSIT));
        vm.prank(OWNER);
        omsetPro.raiseDamageClaim(agreementId, 0, CLAIM_EVIDENCE_URI);
        vm.expectRevert(abi.encodeWithSelector(OmsetPro.InvalidClaimAmount.selector, DEPOSIT + 1, DEPOSIT));
        vm.prank(OWNER);
        omsetPro.raiseDamageClaim(agreementId, DEPOSIT + 1, CLAIM_EVIDENCE_URI);
        vm.expectRevert(OmsetPro.EmptyClaimEvidenceURI.selector);
        vm.prank(OWNER);
        omsetPro.raiseDamageClaim(agreementId, 1 ether, "");

        vm.warp(block.timestamp + INSPECTION_PERIOD);
        vm.expectRevert(abi.encodeWithSelector(OmsetPro.DeadlineExpired.selector, agreementId, block.timestamp));
        vm.prank(OWNER);
        omsetPro.raiseDamageClaim(agreementId, 1 ether, CLAIM_EVIDENCE_URI);
    }

    function testOwnerRaisesOverdueClaimAtReturnDeadline() external {
        uint256 agreementId = _activeAgreement();
        vm.warp(returnDeadline);
        vm.expectEmit(true, true, false, true);
        emit ClaimRaised(agreementId, OWNER, DEPOSIT, CLAIM_EVIDENCE_URI, true, uint64(block.timestamp));
        vm.prank(OWNER);
        omsetPro.raiseOverdueClaim(agreementId, DEPOSIT, CLAIM_EVIDENCE_URI);
        _assertClaim(agreementId, DEPOSIT, true);
    }

    function testOverdueClaimRejectsWrongRoleEarlyCallInvalidAmountAndEvidence() external {
        uint256 agreementId = _activeAgreement();
        _expectUnauthorized(agreementId, BORROWER);
        vm.prank(BORROWER);
        omsetPro.raiseOverdueClaim(agreementId, 1 ether, CLAIM_EVIDENCE_URI);

        vm.expectRevert(abi.encodeWithSelector(OmsetPro.DeadlineNotReached.selector, agreementId, returnDeadline));
        vm.prank(OWNER);
        omsetPro.raiseOverdueClaim(agreementId, 1 ether, CLAIM_EVIDENCE_URI);

        vm.warp(returnDeadline);
        vm.expectRevert(abi.encodeWithSelector(OmsetPro.InvalidClaimAmount.selector, 0, DEPOSIT));
        vm.prank(OWNER);
        omsetPro.raiseOverdueClaim(agreementId, 0, CLAIM_EVIDENCE_URI);
        vm.expectRevert(OmsetPro.EmptyClaimEvidenceURI.selector);
        vm.prank(OWNER);
        omsetPro.raiseOverdueClaim(agreementId, 1 ether, "");
    }

    function testBorrowerAcceptsPartialClaimAndConservesPayout() external {
        uint256 claimAmount = 4 ether;
        uint256 agreementId = _claimRequestedAgreement(claimAmount);
        uint256 ownerBefore = OWNER.balance;
        uint256 borrowerBefore = BORROWER.balance;
        vm.expectEmit(true, true, true, true);
        emit ClaimAccepted(agreementId, BORROWER, OWNER, claimAmount, DEPOSIT - claimAmount);
        vm.prank(BORROWER);
        omsetPro.acceptClaim(agreementId);
        assertEq(OWNER.balance - ownerBefore, claimAmount);
        assertEq(BORROWER.balance - borrowerBefore, DEPOSIT - claimAmount);
        assertEq(address(omsetPro).balance, 0);
        _assertStatus(agreementId, OmsetPro.Status.Claimed);
    }

    function testBorrowerAcceptsFullClaim() external {
        uint256 agreementId = _claimRequestedAgreement(DEPOSIT);
        uint256 ownerBefore = OWNER.balance;
        uint256 borrowerBefore = BORROWER.balance;
        vm.prank(BORROWER);
        omsetPro.acceptClaim(agreementId);
        assertEq(OWNER.balance - ownerBefore, DEPOSIT);
        assertEq(BORROWER.balance, borrowerBefore);
    }

    function testClaimAcceptanceRejectsWrongRoleAndResponseDeadlineBoundary() external {
        uint256 agreementId = _claimRequestedAgreement(4 ether);
        _expectUnauthorized(agreementId, OWNER);
        vm.prank(OWNER);
        omsetPro.acceptClaim(agreementId);

        vm.warp(block.timestamp + CLAIM_RESPONSE_PERIOD);
        vm.expectRevert(abi.encodeWithSelector(OmsetPro.DeadlineExpired.selector, agreementId, block.timestamp));
        vm.prank(BORROWER);
        omsetPro.acceptClaim(agreementId);
    }

    function testBorrowerDisputesClaim() external {
        uint256 agreementId = _claimRequestedAgreement(4 ether);
        vm.expectEmit(true, true, true, true);
        emit ClaimDisputed(agreementId, BORROWER, ARBITER);
        vm.prank(BORROWER);
        omsetPro.disputeClaim(agreementId);
        _assertStatus(agreementId, OmsetPro.Status.Disputed);
    }

    function testClaimDisputeRejectsWrongRoleAndResponseDeadlineBoundary() external {
        uint256 agreementId = _claimRequestedAgreement(4 ether);
        _expectUnauthorized(agreementId, OWNER);
        vm.prank(OWNER);
        omsetPro.disputeClaim(agreementId);

        vm.warp(block.timestamp + CLAIM_RESPONSE_PERIOD);
        vm.expectRevert(abi.encodeWithSelector(OmsetPro.DeadlineExpired.selector, agreementId, block.timestamp));
        vm.prank(BORROWER);
        omsetPro.disputeClaim(agreementId);
    }

    function testOwnerFinalizesUnansweredPartialClaimAtDeadline() external {
        uint256 claimAmount = 4 ether;
        uint256 agreementId = _claimRequestedAgreement(claimAmount);
        uint256 ownerBefore = OWNER.balance;
        uint256 borrowerBefore = BORROWER.balance;
        vm.warp(block.timestamp + CLAIM_RESPONSE_PERIOD);
        vm.expectEmit(true, true, true, true);
        emit ClaimFinalized(agreementId, OWNER, BORROWER, claimAmount, DEPOSIT - claimAmount);
        vm.prank(OWNER);
        omsetPro.finalizeUnansweredClaim(agreementId);
        assertEq(OWNER.balance - ownerBefore, claimAmount);
        assertEq(BORROWER.balance - borrowerBefore, DEPOSIT - claimAmount);
        _assertStatus(agreementId, OmsetPro.Status.Claimed);
    }

    function testUnansweredClaimFinalizationRejectsWrongRoleAndEarlyCall() external {
        uint256 agreementId = _claimRequestedAgreement(4 ether);
        _expectUnauthorized(agreementId, BORROWER);
        vm.prank(BORROWER);
        omsetPro.finalizeUnansweredClaim(agreementId);

        uint256 deadline = block.timestamp + CLAIM_RESPONSE_PERIOD;
        vm.expectRevert(abi.encodeWithSelector(OmsetPro.DeadlineNotReached.selector, agreementId, deadline));
        vm.prank(OWNER);
        omsetPro.finalizeUnansweredClaim(agreementId);
    }

    function testArbiterResolvesDisputeWithZeroAwardAsRefunded() external {
        _assertDisputeResolution(0, OmsetPro.Status.Refunded);
    }

    function testArbiterResolvesDisputeWithPartialAwardAsClaimed() external {
        _assertDisputeResolution(4 ether, OmsetPro.Status.Claimed);
    }

    function testArbiterResolvesDisputeWithFullAwardAsClaimed() external {
        _assertDisputeResolution(DEPOSIT, OmsetPro.Status.Claimed);
    }

    function testDisputeResolutionRejectsWrongRoleInvalidStatusAndExcessAward() external {
        uint256 agreementId = _disputedAgreement(4 ether);
        _expectUnauthorized(agreementId, OWNER);
        vm.prank(OWNER);
        omsetPro.resolveDispute(agreementId, 1 ether);

        vm.expectRevert(abi.encodeWithSelector(OmsetPro.InvalidClaimAmount.selector, DEPOSIT + 1, DEPOSIT));
        vm.prank(ARBITER);
        omsetPro.resolveDispute(agreementId, DEPOSIT + 1);

        uint256 claimId = _claimRequestedAgreement(1 ether);
        _expectStatus(claimId, OmsetPro.Status.Disputed, OmsetPro.Status.ClaimRequested);
        vm.prank(ARBITER);
        omsetPro.resolveDispute(claimId, 1 ether);
    }

    function testTerminalAgreementCannotTransitionAgain() external {
        uint256 agreementId = _returnRequestedAgreement();
        vm.prank(OWNER);
        omsetPro.confirmSuccessfulReturn(agreementId);
        _expectStatus(agreementId, OmsetPro.Status.ReturnRequested, OmsetPro.Status.Refunded);
        vm.prank(OWNER);
        omsetPro.raiseDamageClaim(agreementId, 1 ether, CLAIM_EVIDENCE_URI);
    }

    function testForcedNativeTokenDoesNotAffectAgreementAccounting() external {
        uint256 agreementId = _returnRequestedAgreement();
        uint256 forcedAmount = 3 ether;
        vm.deal(address(omsetPro), DEPOSIT + forcedAmount);
        uint256 borrowerBefore = BORROWER.balance;

        vm.prank(OWNER);
        omsetPro.confirmSuccessfulReturn(agreementId);

        assertEq(BORROWER.balance - borrowerBefore, DEPOSIT);
        assertEq(address(omsetPro).balance, forcedAmount);
    }

    function testRejectingReceiverRevertsPayoutAndPreservesState() external {
        ReentrantParticipant receiver = new ReentrantParticipant(omsetPro);
        uint256 agreementId = _returnRequestedAgreementWithBorrower(address(receiver));
        receiver.setRejectTransfers(true);

        vm.expectRevert(abi.encodeWithSelector(OmsetPro.NativeTransferFailed.selector, address(receiver), DEPOSIT));
        vm.prank(OWNER);
        omsetPro.confirmSuccessfulReturn(agreementId);
        _assertStatus(agreementId, OmsetPro.Status.ReturnRequested);
        assertEq(address(omsetPro).balance, DEPOSIT);
    }

    function testReentrancyBlockedOnMissedHandoverRefund() external {
        ReentrantParticipant receiver = new ReentrantParticipant(omsetPro);
        uint256 agreementId = _fundedAgreementWithBorrower(address(receiver));
        receiver.configureReentry(abi.encodeCall(OmsetPro.refundUnhandedAgreement, (agreementId)));
        vm.warp(handoverDeadline);
        receiver.execute(abi.encodeCall(OmsetPro.refundUnhandedAgreement, (agreementId)));
        _assertReentryBlocked(receiver);
    }

    function testReentrancyBlockedOnSuccessfulReturnConfirmation() external {
        ReentrantParticipant receiver = new ReentrantParticipant(omsetPro);
        uint256 agreementId = _returnRequestedAgreementWithBorrower(address(receiver));
        receiver.configureReentry(abi.encodeCall(OmsetPro.finalizeUnansweredReturn, (agreementId)));
        vm.prank(OWNER);
        omsetPro.confirmSuccessfulReturn(agreementId);
        _assertReentryBlocked(receiver);
    }

    function testReentrancyBlockedOnUnansweredReturnFinalization() external {
        ReentrantParticipant receiver = new ReentrantParticipant(omsetPro);
        uint256 agreementId = _returnRequestedAgreementWithBorrower(address(receiver));
        receiver.configureReentry(abi.encodeCall(OmsetPro.finalizeUnansweredReturn, (agreementId)));
        vm.warp(block.timestamp + INSPECTION_PERIOD);
        receiver.execute(abi.encodeCall(OmsetPro.finalizeUnansweredReturn, (agreementId)));
        _assertReentryBlocked(receiver);
    }

    function testReentrancyBlockedOnClaimAcceptance() external {
        ReentrantParticipant receiver = new ReentrantParticipant(omsetPro);
        uint256 agreementId = _claimRequestedAgreementWithBorrower(address(receiver), 4 ether);
        receiver.configureReentry(abi.encodeCall(OmsetPro.acceptClaim, (agreementId)));
        receiver.execute(abi.encodeCall(OmsetPro.acceptClaim, (agreementId)));
        _assertReentryBlocked(receiver);
    }

    function testReentrancyBlockedOnUnansweredClaimFinalization() external {
        ReentrantParticipant receiver = new ReentrantParticipant(omsetPro);
        uint256 agreementId = _claimRequestedAgreementWithBorrower(address(receiver), 4 ether);
        receiver.configureReentry(abi.encodeCall(OmsetPro.acceptClaim, (agreementId)));
        vm.warp(block.timestamp + CLAIM_RESPONSE_PERIOD);
        vm.prank(OWNER);
        omsetPro.finalizeUnansweredClaim(agreementId);
        _assertReentryBlocked(receiver);
    }

    function testReentrancyBlockedOnDisputeResolution() external {
        ReentrantParticipant receiver = new ReentrantParticipant(omsetPro);
        uint256 agreementId = _claimRequestedAgreementWithBorrower(address(receiver), 4 ether);
        receiver.execute(abi.encodeCall(OmsetPro.disputeClaim, (agreementId)));
        receiver.configureReentry(abi.encodeCall(OmsetPro.resolveDispute, (agreementId, 3 ether)));
        vm.prank(ARBITER);
        omsetPro.resolveDispute(agreementId, 3 ether);
        _assertReentryBlocked(receiver);
    }

    function testFuzzDisputePayoutConservation(uint96 rawDeposit, uint96 rawAward) external {
        uint256 deposit = bound(uint256(rawDeposit), 1, 1_000 ether);
        uint256 award = bound(uint256(rawAward), 0, deposit);
        vm.deal(BORROWER, omsetPro.totalFundingRequired(deposit));
        uint256 agreementId = _createAgreementWith(BORROWER, deposit);
        _fund(agreementId, deposit, BORROWER);
        vm.prank(OWNER);
        omsetPro.confirmHandover(agreementId);
        vm.prank(BORROWER);
        omsetPro.requestReturn(agreementId, RETURN_PROOF_URI);
        vm.prank(OWNER);
        omsetPro.raiseDamageClaim(agreementId, deposit, CLAIM_EVIDENCE_URI);
        vm.prank(BORROWER);
        omsetPro.disputeClaim(agreementId);

        uint256 ownerBefore = OWNER.balance;
        uint256 borrowerBefore = BORROWER.balance;
        vm.prank(ARBITER);
        omsetPro.resolveDispute(agreementId, award);

        assertEq(OWNER.balance - ownerBefore, award);
        assertEq(BORROWER.balance - borrowerBefore, deposit - award);
        assertEq((OWNER.balance - ownerBefore) + (BORROWER.balance - borrowerBefore), deposit);
        assertEq(address(omsetPro).balance, 0);
    }

    function testFuzzExactTotalFundingEnforcement(uint96 rawDeposit, uint96 rawPayment) external {
        uint256 deposit = bound(uint256(rawDeposit), 1, 1_000 ether);
        uint256 payment = bound(uint256(rawPayment), 0, 1_001 ether);
        uint256 total = omsetPro.totalFundingRequired(deposit);
        vm.deal(BORROWER, payment);
        uint256 agreementId = _createAgreementWith(BORROWER, deposit);
        if (payment == total) {
            _fundValue(agreementId, payment, BORROWER);
            _assertStatus(agreementId, OmsetPro.Status.Funded);
            assertEq(address(omsetPro).balance, deposit);
        } else {
            vm.expectRevert(abi.encodeWithSelector(OmsetPro.IncorrectDeposit.selector, total, payment));
            _fundValue(agreementId, payment, BORROWER);
            _assertStatus(agreementId, OmsetPro.Status.Created);
        }
    }

    function testFuzzFundingBeforeHandoverDeadline(uint32 secondsBeforeDeadline) external {
        uint256 agreementId = _createAgreement();
        uint256 offset = bound(uint256(secondsBeforeDeadline), 1, 1 days);
        vm.warp(uint256(handoverDeadline) - offset);

        _fund(agreementId, DEPOSIT, BORROWER);

        _assertStatus(agreementId, OmsetPro.Status.Funded);
    }

    function testFuzzHandoverDeadlineBoundary(uint32 secondsBeforeDeadline) external {
        uint256 agreementId = _fundedAgreement();
        uint256 offset = bound(uint256(secondsBeforeDeadline), 1, 1 days);
        vm.warp(uint256(handoverDeadline) - offset);
        vm.prank(OWNER);
        omsetPro.confirmHandover(agreementId);
        _assertStatus(agreementId, OmsetPro.Status.Active);
    }

    function testFuzzInspectionDeadlineBoundary(uint32 secondsBeforeDeadline) external {
        uint256 agreementId = _returnRequestedAgreement();
        uint256 offset = bound(uint256(secondsBeforeDeadline), 1, INSPECTION_PERIOD);
        vm.warp(block.timestamp + INSPECTION_PERIOD - offset);
        vm.prank(OWNER);
        omsetPro.confirmSuccessfulReturn(agreementId);
        _assertStatus(agreementId, OmsetPro.Status.Refunded);
    }

    function _createAgreement() private returns (uint256) {
        return _createAgreementWith(BORROWER, DEPOSIT);
    }

    function _createAgreementWith(address borrower, uint256 deposit) private returns (uint256) {
        vm.prank(OWNER);
        return omsetPro.createAgreement(
            borrower,
            ARBITER,
            ITEM_NAME,
            ITEM_METADATA_URI,
            deposit,
            handoverDeadline,
            returnDeadline,
            INSPECTION_PERIOD,
            CLAIM_RESPONSE_PERIOD
        );
    }

    function _fundedAgreement() private returns (uint256 agreementId) {
        agreementId = _createAgreement();
        _fund(agreementId, DEPOSIT, BORROWER);
    }

    function _fundedAgreementWithBorrower(address borrower) private returns (uint256 agreementId) {
        uint256 total = omsetPro.totalFundingRequired(DEPOSIT);
        vm.deal(borrower, total);
        agreementId = _createAgreementWith(borrower, DEPOSIT);
        ReentrantParticipant(payable(borrower)).execute{value: total}(
            abi.encodeCall(OmsetPro.fundAgreement, (agreementId))
        );
    }

    function _activeAgreement() private returns (uint256 agreementId) {
        agreementId = _fundedAgreement();
        vm.prank(OWNER);
        omsetPro.confirmHandover(agreementId);
    }

    function _activeAgreementWithBorrower(address borrower) private returns (uint256 agreementId) {
        agreementId = _fundedAgreementWithBorrower(borrower);
        vm.prank(OWNER);
        omsetPro.confirmHandover(agreementId);
    }

    function _returnRequestedAgreement() private returns (uint256 agreementId) {
        agreementId = _activeAgreement();
        vm.prank(BORROWER);
        omsetPro.requestReturn(agreementId, RETURN_PROOF_URI);
    }

    function _returnRequestedAgreementWithBorrower(address borrower) private returns (uint256 agreementId) {
        agreementId = _activeAgreementWithBorrower(borrower);
        ReentrantParticipant(payable(borrower))
            .execute(abi.encodeCall(OmsetPro.requestReturn, (agreementId, RETURN_PROOF_URI)));
    }

    function _claimRequestedAgreement(uint256 claimAmount) private returns (uint256 agreementId) {
        agreementId = _returnRequestedAgreement();
        vm.prank(OWNER);
        omsetPro.raiseDamageClaim(agreementId, claimAmount, CLAIM_EVIDENCE_URI);
    }

    function _claimRequestedAgreementWithBorrower(address borrower, uint256 claimAmount)
        private
        returns (uint256 agreementId)
    {
        agreementId = _returnRequestedAgreementWithBorrower(borrower);
        vm.prank(OWNER);
        omsetPro.raiseDamageClaim(agreementId, claimAmount, CLAIM_EVIDENCE_URI);
    }

    function _disputedAgreement(uint256 claimAmount) private returns (uint256 agreementId) {
        agreementId = _claimRequestedAgreement(claimAmount);
        vm.prank(BORROWER);
        omsetPro.disputeClaim(agreementId);
    }

    function _fund(uint256 agreementId, uint256 deposit, address borrower) private {
        _fundValue(agreementId, deposit + (deposit * 100) / 10_000, borrower);
    }

    function _fundValue(uint256 agreementId, uint256 amount, address borrower) private {
        vm.prank(borrower);
        omsetPro.fundAgreement{value: amount}(agreementId);
    }

    function _assertDisputeResolution(uint256 award, OmsetPro.Status expectedStatus) private {
        uint256 agreementId = _disputedAgreement(4 ether);
        uint256 ownerBefore = OWNER.balance;
        uint256 borrowerBefore = BORROWER.balance;
        vm.expectEmit(true, true, true, true);
        emit DisputeResolved(agreementId, ARBITER, OWNER, BORROWER, award, DEPOSIT - award);
        vm.prank(ARBITER);
        omsetPro.resolveDispute(agreementId, award);
        assertEq(OWNER.balance - ownerBefore, award);
        assertEq(BORROWER.balance - borrowerBefore, DEPOSIT - award);
        assertEq(address(omsetPro).balance, 0);
        _assertStatus(agreementId, expectedStatus);
    }

    function _assertClaim(uint256 agreementId, uint256 amount, bool overdue) private view {
        OmsetPro.Agreement memory agreement = omsetPro.getAgreement(agreementId);
        assertEq(uint256(agreement.status), uint256(OmsetPro.Status.ClaimRequested));
        assertEq(agreement.claimCreationTimestamp, block.timestamp);
        assertEq(agreement.claimAmount, amount);
        assertEq(agreement.claimEvidenceURI, CLAIM_EVIDENCE_URI);
        if (overdue) assertEq(agreement.returnRequestTimestamp, 0);
    }

    function _assertReentryBlocked(ReentrantParticipant participant) private view {
        assertTrue(participant.reentryAttempted());
        assertFalse(participant.reentrySucceeded());
        assertEq(participant.reentryError(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
    }

    function _assertStatus(uint256 agreementId, OmsetPro.Status expected) private view {
        assertEq(uint256(omsetPro.getAgreement(agreementId).status), uint256(expected));
    }

    function _expectUnauthorized(uint256 agreementId, address caller) private {
        vm.expectRevert(abi.encodeWithSelector(OmsetPro.Unauthorized.selector, agreementId, caller));
    }

    function _expectStatus(uint256 agreementId, OmsetPro.Status expected, OmsetPro.Status actual) private {
        vm.expectRevert(abi.encodeWithSelector(OmsetPro.InvalidStatus.selector, agreementId, expected, actual));
    }

    function _expectCreateRevert(
        bytes4 selector,
        address borrower,
        address arbiter,
        string memory itemName,
        string memory metadataURI,
        uint256 deposit,
        uint64 handover,
        uint64 returnBy,
        uint64 inspection,
        uint64 claimResponse
    ) private {
        vm.expectRevert(selector);
        vm.prank(OWNER);
        omsetPro.createAgreement(
            borrower, arbiter, itemName, metadataURI, deposit, handover, returnBy, inspection, claimResponse
        );
    }

    function _singleId(uint256 agreementId) private pure returns (uint256[] memory ids) {
        ids = new uint256[](1);
        ids[0] = agreementId;
    }
}
