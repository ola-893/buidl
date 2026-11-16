// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Controlled local protocol fixture. Implements the read/write ABI used by the demo.
contract LocalDeweb {
    error Unauthorized();
    error InvalidUpload();
    error NoSuchFile();

    struct File {
        bytes data;
        string mime;
        bytes32 digest;
        uint40 updated;
        uint256 chunks;
    }

    event HolderTransferred(address indexed previous, address indexed current, uint256 epoch);
    event UploadStatus(bool active);

    address public holder;
    uint256 public epoch = 1;
    bool public uploading;
    string private fallbackFile;
    string[] private paths;
    mapping(string => File) private files;

    constructor() { holder = msg.sender; }

    modifier onlyHolder() {
        if (msg.sender != holder) revert Unauthorized();
        _;
    }

    modifier onlySite(address container) {
        if (container != address(this)) revert Unauthorized();
        _;
    }

    function authority(address processor, uint256 circuitId, address container) external view returns (address, uint256) {
        if (processor != address(this) || circuitId != 1 || container != address(this)) return (address(0), 0);
        return (holder, epoch);
    }

    function transfer(address next) public virtual onlyHolder {
        if (next == address(0) || next == holder) revert Unauthorized();
        address previous = holder;
        holder = next;
        emit HolderTransferred(previous, next, ++epoch);
    }

    function setUploading(bool active) external onlyHolder {
        uploading = active;
        emit UploadStatus(active);
    }

    function pathCount(address container) external view onlySite(container) returns (uint256) {
        return paths.length;
    }

    function pathsRange(address container, uint256 from, uint256 n) external view onlySite(container) returns (string[] memory result) {
        if (from > paths.length) revert InvalidUpload();
        uint256 remaining = paths.length - from;
        result = new string[](n < remaining ? n : remaining);
        for (uint256 i; i < result.length; ++i) result[i] = paths[from + i];
    }

    function fallbackPath(address container) external view onlySite(container) returns (string memory) {
        return fallbackFile;
    }

    function fileInfo(address container, string calldata path)
        external view onlySite(container) returns (uint32, string memory, bytes32, uint40, uint256)
    {
        File storage file = files[path];
        return (uint32(file.data.length), file.mime, file.digest, file.updated, file.chunks);
    }

    function read(address container, string calldata path) external view onlySite(container) returns (bytes memory) {
        if (files[path].chunks == 0) revert NoSuchFile();
        return files[path].data;
    }

    function readRange(address container, string calldata path, uint256 offset, uint256 len)
        external view onlySite(container) returns (bytes memory part)
    {
        File storage file = files[path];
        if (file.chunks == 0) revert NoSuchFile();
        bytes memory data = file.data;
        if (offset >= data.length) return new bytes(0);
        uint256 remaining = data.length - offset;
        part = new bytes(len < remaining ? len : remaining);
        for (uint256 i; i < part.length; ++i) part[i] = data[offset + i];
    }

    function putFile(address container, string calldata path, string calldata contentType, bytes32 sha256Hash, bytes calldata data)
        external onlyHolder onlySite(container)
    {
        if (bytes(path).length == 0 || data.length > 24000) revert InvalidUpload();
        if (files[path].chunks == 0) paths.push(path);
        files[path] = File(data, contentType, sha256Hash, uint40(block.timestamp), 1);
    }

    function appendChunk(address container, string calldata path, uint256 expectIndex, bytes calldata data)
        external onlyHolder onlySite(container)
    {
        File storage file = files[path];
        if (file.chunks != expectIndex || expectIndex == 0 || expectIndex >= 350 || data.length > 24000) revert InvalidUpload();
        file.data = bytes.concat(file.data, data);
        file.updated = uint40(block.timestamp);
        ++file.chunks;
    }

    function removeFile(address container, string calldata path) external onlyHolder onlySite(container) {
        delete files[path];
        for (uint256 i; i < paths.length; ++i) {
            if (keccak256(bytes(paths[i])) != keccak256(bytes(path))) continue;
            paths[i] = paths[paths.length - 1];
            paths.pop();
            return;
        }
    }

    function setFallback(address container, string calldata path) external onlyHolder onlySite(container) {
        if (bytes(path).length != 0 && files[path].chunks == 0) revert NoSuchFile();
        fallbackFile = path;
    }
}
