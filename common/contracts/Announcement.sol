// SPDX-License-Identifier: MIT
pragma solidity ^0.7.4;
pragma experimental ABIEncoderV2;

contract Announcement {
    struct Entry {
        bytes key;
        bytes value;
    }

    event Announce(address indexed announcer, bytes indexed keyHash, bytes key, bytes value);

    function announce(bytes calldata key, bytes calldata value)
    external returns (uint count) {
        emit Announce(msg.sender, key, key, value);
        return 1;
    }

    function announce(Entry[] calldata array)
    external returns (uint count) {
        for (uint i = 0; i < array.length; i++) {
            emit Announce(msg.sender, array[i].key, array[i].key, array[i].value);
        }
        return array.length;
    }
}
