// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ISiteAuthority, ReleaseRegistry} from "./ReleaseRegistry.sol";

interface ITapeFactory {
    function isCPU(address processor) external view returns (bool);
}
interface ITapeBeacon {
    function owner() external view returns (address);
    function implementation() external view returns (address);
}
interface ITapeCircuit {
    function ownerOf(uint256 tokenId) external view returns (address);
    function safeTransferFrom(address from, address to, uint256 tokenId) external;
}
interface ITapeOpener {
    function accountOf(address processor, uint256 tokenId) external view returns (address);
    function isOpened(address processor, uint256 tokenId) external view returns (bool);
}
interface ITapeStoreWrites {
    function putFile(address container, string calldata path, string calldata mime, bytes32 digest, bytes calldata chunk) external;
    function appendChunk(address container, string calldata path, uint256 index, bytes calldata chunk) external;
    function removeFile(address container, string calldata path) external;
    function setFallback(address container, string calldata path) external;
}
interface ITapeBinding {
    function bind(string calldata name, address container, uint256 months) external payable;
}

/// One enrolled TapeOut circuit. Custody gives the registry an observable, monotonic ownership epoch.
contract TapeOutSiteAuthority is ISiteAuthority {
    address public constant FACTORY = 0x1f09DAeFA827f02CBb40967cc91b259763760761;
    address public constant OPENER = 0x536adD8F30f03b69f6fbF29d425A816A0dC50106;
    address public constant STORE = 0xd6EFb7adCc9c83dC4924Ad56f6a8E4e969b9ADB6;
    address public constant BINDING = 0x68809Fd2fb343aA57D0aeB7f33Defe477c9666f9;
    address private constant BEACON = 0xf70d1ed4f62CF3780157B0b421b7E2F45bD0991C;
    address private constant CIRCUITS = 0x977f217887E085D298Cb3819cDAD5A0ee35F29B2;
    bytes32 private constant PROCESSOR_CODE_HASH = 0x57aa306fd0be97087da3534e03398f5ff4efd533b5be4e45a405ce86fa6717d5;

    error WrongSite();
    error Unauthorized();
    error InvalidEnrollment();
    error InvalidPublication();

    event Enrolled(address indexed governor, uint256 indexed epoch, address registry);
    event Released(address indexed recipient, uint256 indexed epoch);
    event PublicationStarted(uint256 indexed attempt, uint256 indexed sequence, bytes32 manifestDigest);
    event PublicationFinished(uint256 indexed attempt, uint256 indexed sequence, bytes32 manifestDigest);

    // Constructor-only site binding. Storage rather than immutables keeps the runtime identical
    // across sites so public clients can recognize the exact reviewed implementation by code hash.
    address public processor;
    uint256 public circuitId;
    address public container;
    ReleaseRegistry public registry;
    address public governor;
    uint256 public epoch;

    struct Publication {
        uint256 attempt;
        uint256 sequence;
        bytes32 manifestDigest;
        bool inProgress;
    }
    Publication public publication;

    constructor(address processor_, uint256 circuitId_) {
        if (block.chainid != 196 || circuitId_ == 0 || !supportedProcessor(processor_) ||
            !ITapeFactory(FACTORY).isCPU(processor_)) revert WrongSite();
        // Fail early for an unminted token.
        ITapeCircuit(processor_).ownerOf(circuitId_);
        processor = processor_;
        circuitId = circuitId_;
        container = ITapeOpener(OPENER).accountOf(processor_, circuitId_);
    }

    function supportedProcessor(address processor_) private view returns (bool) {
        return processor_.codehash == PROCESSOR_CODE_HASH &&
            ITapeBeacon(BEACON).owner() == address(0) && ITapeBeacon(BEACON).implementation() == CIRCUITS;
    }

    function hasCustody() private view returns (bool) {
        return governor != address(0) && supportedProcessor(processor) &&
            ITapeCircuit(processor).ownerOf(circuitId) == address(this);
    }

    modifier onlyGovernor() {
        if (msg.sender != governor || !hasCustody()) revert Unauthorized();
        _;
    }

    function authority(address processor_, uint256 tokenId, address container_)
        external view returns (address, uint256)
    {
        if (processor_ != processor || tokenId != circuitId || container_ != container || !hasCustody()) {
            return (address(0), epoch);
        }
        return (governor, epoch);
    }

    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data)
        external returns (bytes4)
    {
        if (msg.sender != processor || tokenId != circuitId || from == address(0) || operator != from ||
            governor != address(0) || ITapeCircuit(processor).ownerOf(tokenId) != address(this) ||
            !supportedProcessor(processor) || !ITapeOpener(OPENER).isOpened(processor, circuitId)) revert InvalidEnrollment();

        if (address(registry) == address(0)) {
            if (data.length != 32) revert InvalidEnrollment();
            registry = new ReleaseRegistry(this, abi.decode(data, (bytes32)));
        } else if (data.length != 0) {
            revert InvalidEnrollment();
        }
        governor = from;
        ++epoch;
        emit Enrolled(from, epoch, address(registry));
        return this.onERC721Received.selector;
    }

    function releaseTo(address recipient) external onlyGovernor {
        if (recipient == address(0) || recipient == address(this) || recipient == container) revert InvalidEnrollment();
        governor = address(0);
        ++epoch;
        publication.sequence = 0;
        publication.manifestDigest = bytes32(0);
        publication.inProgress = false;
        emit Released(recipient, epoch);
        ITapeCircuit(processor).safeTransferFrom(address(this), recipient, circuitId);
    }

    function bind(string calldata name, uint256 months) external payable onlyGovernor {
        ITapeBinding(BINDING).bind{value: msg.value}(name, container, months);
    }

    function beginPublication(uint256 expectedAttempt, uint256 sequence, bytes32 manifestDigest) external onlyGovernor {
        if (publication.attempt != expectedAttempt) revert InvalidPublication();
        requireApproval(sequence, manifestDigest);
        publication = Publication(expectedAttempt + 1, sequence, manifestDigest, true);
        emit PublicationStarted(expectedAttempt + 1, sequence, manifestDigest);
    }

    function write(uint256 attempt, bytes calldata callData) external onlyGovernor {
        requirePublication(attempt);
        if (callData.length < 36 || abi.decode(callData[4:36], (address)) != container) revert WrongSite();
        bytes4 selector = bytes4(callData[:4]);
        if (selector != ITapeStoreWrites.putFile.selector && selector != ITapeStoreWrites.appendChunk.selector &&
            selector != ITapeStoreWrites.removeFile.selector && selector != ITapeStoreWrites.setFallback.selector) revert WrongSite();
        (bool success, bytes memory reason) = STORE.call(callData);
        if (!success) {
            assembly ("memory-safe") { revert(add(reason, 32), mload(reason)) }
        }
    }

    function finishPublication(uint256 attempt) external onlyGovernor {
        requirePublication(attempt);
        publication.inProgress = false;
        emit PublicationFinished(attempt, publication.sequence, publication.manifestDigest);
    }

    function requirePublication(uint256 attempt) private view {
        if (!publication.inProgress || publication.attempt != attempt) revert InvalidPublication();
        requireApproval(publication.sequence, publication.manifestDigest);
    }

    function requireApproval(uint256 sequence, bytes32 manifestDigest) private view {
        ReleaseRegistry.Site memory site = ReleaseRegistry.Site(processor, circuitId, container);
        (ReleaseRegistry.Policy memory policy, ReleaseRegistry.Commitment memory commitment, bool current) = registry.status(site);
        if (!current || policy.version == 0 || commitment.approval.policyVersion != policy.version ||
            sequence == 0 || commitment.approval.sequence != sequence || commitment.approval.manifestDigest != manifestDigest ||
            commitment.revoked || commitment.approval.expiry <= block.timestamp) revert InvalidPublication();
    }
}
