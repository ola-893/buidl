// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface ISiteAuthority {
    function authority(address processor, uint256 circuitId, address container)
        external view returns (address holder, uint256 epoch);
}

contract ReleaseRegistry {
    error Unauthorized();
    error InvalidPolicy();
    error InvalidRelease();
    error InvalidSignature();

    bytes32 private constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract,bytes32 salt)"
    );
    bytes32 private constant APPROVAL_TYPEHASH = keccak256(
        "ReleaseApproval(bytes32 siteKey,uint256 policyVersion,uint256 sequence,uint256 expiry,uint256 schemaVersion,bytes32 manifestDigest,bytes32 artifactDigest,bool rollback)"
    );
    uint256 private constant HALF_ORDER = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    struct Site {
        address processor;
        uint256 circuitId;
        address container;
    }
    struct Policy {
        address holder;
        uint256 epoch;
        uint256 version;
        uint256 threshold;
        address[] reviewers;
    }
    struct ReleaseApproval {
        bytes32 siteKey;
        uint256 policyVersion;
        uint256 sequence;
        uint256 expiry;
        uint256 schemaVersion;
        bytes32 manifestDigest;
        bytes32 artifactDigest;
        bool rollback;
    }
    struct Commitment {
        ReleaseApproval approval;
        bool revoked;
        address[] signers;
    }

    ISiteAuthority public immutable authoritySource;
    bytes32 public immutable instanceSalt;
    mapping(bytes32 => Policy) private policies;
    mapping(bytes32 => Commitment) private commitments;
    mapping(bytes32 => mapping(bytes32 => bool)) public seenArtifact;

    event PolicySet(bytes32 indexed siteKey, uint256 version, address holder, uint256 epoch, uint256 threshold, address[] reviewers);
    event ReleaseRecorded(bytes32 indexed siteKey, uint256 indexed sequence, bytes32 manifestDigest, bytes32 artifactDigest, uint256 policyVersion, uint256 expiry, bool rollback, address[] signers);
    event ReleaseRevoked(bytes32 indexed siteKey, uint256 indexed sequence);

    constructor(ISiteAuthority source, bytes32 salt) {
        if (address(source).code.length == 0 || salt == bytes32(0)) revert InvalidPolicy();
        authoritySource = source;
        instanceSalt = salt;
    }

    function key(Site calldata site) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, site.processor, site.circuitId, site.container));
    }

    function status(Site calldata site) external view returns (Policy memory policy, Commitment memory commitment, bool authorityCurrent) {
        bytes32 siteKey = key(site);
        policy = policies[siteKey];
        commitment = commitments[siteKey];
        if (policy.version != 0) {
            (address holder, uint256 epoch) = authoritySource.authority(site.processor, site.circuitId, site.container);
            authorityCurrent = holder == policy.holder && epoch == policy.epoch;
        }
    }

    function setPolicy(Site calldata site, address[] calldata reviewers, uint256 threshold) external {
        (address holder, uint256 epoch) = authoritySource.authority(site.processor, site.circuitId, site.container);
        if (holder == address(0) || holder != msg.sender) revert Unauthorized();
        if (threshold == 0 || threshold > reviewers.length || reviewers.length > 31) revert InvalidPolicy();
        address previous;
        for (uint256 i; i < reviewers.length; ++i) {
            address reviewer = reviewers[i];
            if (reviewer <= previous || reviewer == holder) revert InvalidPolicy();
            previous = reviewer;
        }

        bytes32 siteKey = key(site);
        Policy storage policy = policies[siteKey];
        policy.holder = holder;
        policy.epoch = epoch;
        ++policy.version;
        policy.threshold = threshold;
        policy.reviewers = reviewers;
        emit PolicySet(siteKey, policy.version, holder, epoch, threshold, reviewers);
    }

    function record(Site calldata site, ReleaseApproval calldata approval, bytes[] calldata signatures) external {
        bytes32 siteKey = key(site);
        Policy storage policy = policies[siteKey];
        Commitment storage previous = commitments[siteKey];
        (address holder, uint256 epoch) = authoritySource.authority(site.processor, site.circuitId, site.container);
        if (policy.version == 0 || holder != policy.holder || epoch != policy.epoch) revert Unauthorized();
        if (
            approval.siteKey != siteKey || approval.policyVersion != policy.version ||
            approval.sequence != previous.approval.sequence + 1 || approval.expiry <= block.timestamp ||
            approval.schemaVersion != 1 || approval.manifestDigest == bytes32(0) || approval.artifactDigest == bytes32(0) ||
            approval.rollback != seenArtifact[siteKey][approval.artifactDigest]
        ) revert InvalidRelease();
        if (signatures.length < policy.threshold || signatures.length > policy.reviewers.length) revert InvalidSignature();

        bytes32 domain = keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256("buidl"), keccak256("1"), block.chainid, address(this), instanceSalt));
        bytes32 approvalHash = keccak256(abi.encode(APPROVAL_TYPEHASH, approval));
        bytes32 signedDigest = keccak256(abi.encodePacked(hex"1901", domain, approvalHash));
        address[] memory signers = new address[](signatures.length);
        uint256 reviewerIndex;
        for (uint256 i; i < signatures.length; ++i) {
            address signer = recover(signedDigest, signatures[i]);
            while (reviewerIndex < policy.reviewers.length && policy.reviewers[reviewerIndex] < signer) ++reviewerIndex;
            if (reviewerIndex == policy.reviewers.length || policy.reviewers[reviewerIndex] != signer) revert InvalidSignature();
            ++reviewerIndex;
            signers[i] = signer;
        }

        previous.approval = approval;
        previous.revoked = false;
        previous.signers = signers;
        seenArtifact[siteKey][approval.artifactDigest] = true;
        emit ReleaseRecorded(siteKey, approval.sequence, approval.manifestDigest, approval.artifactDigest, approval.policyVersion, approval.expiry, approval.rollback, signers);
    }

    function revoke(Site calldata site, uint256 sequence) external {
        bytes32 siteKey = key(site);
        Policy storage policy = policies[siteKey];
        (address holder, uint256 epoch) = authoritySource.authority(site.processor, site.circuitId, site.container);
        if (msg.sender != holder || holder != policy.holder || epoch != policy.epoch) revert Unauthorized();
        Commitment storage commitment = commitments[siteKey];
        if (sequence == 0 || sequence != commitment.approval.sequence || commitment.revoked) revert InvalidRelease();
        commitment.revoked = true;
        emit ReleaseRevoked(siteKey, sequence);
    }

    function recover(bytes32 hash, bytes calldata signature) private pure returns (address signer) {
        if (signature.length != 65) revert InvalidSignature();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (uint256(s) > HALF_ORDER || (v != 27 && v != 28)) revert InvalidSignature();
        signer = ecrecover(hash, v, r, s);
        if (signer == address(0)) revert InvalidSignature();
    }
}
