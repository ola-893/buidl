// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {LocalDeweb} from "./LocalDeweb.sol";

interface ITestCircuitReceiver {
    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data) external returns (bytes4);
}

/// Test fixture on X Layer testnet. One simulated circuit, opened container and site store.
contract TestnetDeweb is LocalDeweb {
    error WrongNetwork();
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);

    constructor() {
        if (block.chainid != 1952) revert WrongNetwork();
        emit Transfer(address(0), msg.sender, 1);
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        if (tokenId != 1) revert NoSuchFile();
        return holder;
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes calldata data) external onlyHolder {
        if (from != holder || tokenId != 1 || to == address(0) || to == address(this) || to == holder) revert Unauthorized();
        move(to);
        if (to.code.length != 0 && ITestCircuitReceiver(to).onERC721Received(msg.sender, from, tokenId, data) !=
            ITestCircuitReceiver.onERC721Received.selector) revert Unauthorized();
    }

    function transfer(address next) public override onlyHolder {
        if (next == address(0) || next == address(this) || next == holder) revert Unauthorized();
        move(next);
    }

    function move(address next) private {
        address previous = holder;
        holder = next;
        emit HolderTransferred(previous, next, ++epoch);
        emit Transfer(previous, next, 1);
    }
}
