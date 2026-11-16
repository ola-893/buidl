// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ISiteAuthority, ReleaseRegistry} from "./ReleaseRegistry.sol";
import {TestnetDeweb} from "./TestnetDeweb.sol";

/// Test fixture. Simulates custody and publication against TestnetDeweb only.
contract TestnetAuthority is ISiteAuthority {
    error WrongNetwork();
    error Unauthorized();
    error InvalidPublication();

    event Enrolled(address indexed governor, uint256 epoch, address registry);
    event Released(address indexed recipient, uint256 epoch);
    event PublicationStarted(uint256 attempt, uint256 sequence);
    event PublicationFinished(uint256 attempt, uint256 sequence);

    TestnetDeweb public fixture;
    ReleaseRegistry public registry;
    address public governor;
    uint256 public epoch;
    uint256 public attempt;
    uint256 public sequence;
    bytes32 public manifestDigest;
    bool public inProgress;

    constructor(address fixture_) {
        if (block.chainid != 1952) revert WrongNetwork();
        if (fixture_ == address(0)) revert Unauthorized();
        fixture = TestnetDeweb(fixture_);
    }

    function held() private view returns (bool) {
        return governor != address(0) && fixture.holder() == address(this);
    }

    modifier onlyGovernor() {
        if (msg.sender != governor || !held()) revert Unauthorized();
        _;
    }

    function authority(address processor, uint256 tokenId, address container) external view returns (address, uint256) {
        if (processor != address(fixture) || container != address(fixture) || tokenId != 1 || !held()) {
            return (address(0), epoch);
        }
        return (governor, epoch);
    }

    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data) external returns (bytes4) {
        if (msg.sender != address(fixture) || tokenId != 1 || from == address(0) || operator != from ||
            governor != address(0) || fixture.holder() != address(this)) revert Unauthorized();
        if (address(registry) == address(0)) {
            if (data.length != 32) revert Unauthorized();
            registry = new ReleaseRegistry(this, abi.decode(data, (bytes32)));
        } else if (data.length != 0) revert Unauthorized();
        governor = from;
        ++epoch;
        emit Enrolled(from, epoch, address(registry));
        return this.onERC721Received.selector;
    }

    function returnCircuit() external onlyGovernor {
        address recipient = governor;
        governor = address(0);
        ++epoch;
        inProgress = false;
        sequence = 0;
        manifestDigest = bytes32(0);
        fixture.setUploading(false);
        fixture.transfer(recipient);
        emit Released(recipient, epoch);
    }

    function beginPublication(uint256 expectedAttempt, uint256 sequence_, bytes32 digest_) external onlyGovernor {
        if (attempt != expectedAttempt) revert InvalidPublication();
        requireApproval(sequence_, digest_);
        ++attempt;
        sequence = sequence_;
        manifestDigest = digest_;
        inProgress = true;
        fixture.setUploading(true);
        emit PublicationStarted(attempt, sequence);
    }

    function write(uint256 expectedAttempt, bytes calldata callData) external onlyGovernor {
        if (!inProgress || attempt != expectedAttempt) revert InvalidPublication();
        requireApproval(sequence, manifestDigest);
        if (callData.length < 36 || abi.decode(callData[4:36], (address)) != address(fixture)) revert Unauthorized();
        bytes4 selector = bytes4(callData[:4]);
        if (selector != fixture.putFile.selector && selector != fixture.appendChunk.selector &&
            selector != fixture.removeFile.selector && selector != fixture.setFallback.selector) revert Unauthorized();
        (bool success, bytes memory reason) = address(fixture).call(callData);
        if (!success) {
            assembly ("memory-safe") { revert(add(reason, 32), mload(reason)) }
        }
    }

    function finishPublication(uint256 expectedAttempt) external onlyGovernor {
        if (!inProgress || attempt != expectedAttempt) revert InvalidPublication();
        requireApproval(sequence, manifestDigest);
        inProgress = false;
        fixture.setUploading(false);
        emit PublicationFinished(attempt, sequence);
    }

    function requireApproval(uint256 expectedSequence, bytes32 expectedDigest) private view {
        ReleaseRegistry.Site memory site = ReleaseRegistry.Site(address(fixture), 1, address(fixture));
        (ReleaseRegistry.Policy memory policy, ReleaseRegistry.Commitment memory commitment, bool current) = registry.status(site);
        if (!current || expectedSequence == 0 || policy.version != commitment.approval.policyVersion ||
            commitment.approval.sequence != expectedSequence || commitment.approval.manifestDigest != expectedDigest ||
            commitment.revoked || commitment.approval.expiry <= block.timestamp) revert InvalidPublication();
    }
}
