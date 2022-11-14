// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import '../registry/ENS.sol';
import '../resolvers/Resolver.sol';
import '../registry/IReverseRegistrar.sol';
import './ENSNamehash.sol';

// put this file under  https://github.com/ensdomains/ens-contracts.git/contracts/utils
// then compile and get abi
contract ENSChecker {

    using ENSNamehash for bytes;

    function getReverseNameByAddress(address ens,address reverse, address who)
    public
    view
    returns (string memory)
    {
        bytes32 node = IReverseRegistrar(reverse).node(who);
        address resolver = ENS(ens).resolver(node);
        if (resolver == address(0)) {
            return '';
        }
        return Resolver(resolver).name(node);
    }

    function getAddrOfName(address ens,address reverse, string memory name)
    public
    view
    returns (address resolvedAddr,bytes32 node)
    {
        bytes32 node = (bytes(name)).namehash();
        address resolver = ENS(ens).resolver(node);
        if (resolver == address(0)) {
            return (address(0),node);
        }
        address resolvedAddr = Resolver(resolver).addr(node);
        return (resolvedAddr, node);
    }

    function getAddrOfName(address ens,address reverse, string memory name, uint256 coinType)
    public
    view
    returns (address resolvedAddr,bytes32 node)
    {
        bytes32 node = (bytes(name)).namehash();
        address resolver = ENS(ens).resolver(node);
        if (resolver == address(0)) {
            return (address(0),node);
        }
        bytes memory resolvedAddrBytes = Resolver(resolver).addr(node, coinType);
        address resolvedAddr = address(readBytes20(resolvedAddrBytes, 0));
        return (resolvedAddr, node);
    }

    function getEnsNameMatch(address ens,address reverse, address who, string memory domain)
    public
    view
    returns (string memory)
    {
        string memory name = getReverseNameByAddress(ens, reverse, who);
        if(bytes(name).length == 0) {
            return '';
        }
        if(bytes(domain).length > 0) {
            name = string(abi.encodePacked(name, domain));
        }
        bytes32 node;
        address resolvedAddr;
        (resolvedAddr, node) = getAddrOfName(ens, reverse, name);
        if (resolvedAddr == who) {
            return name;
        }
        return '';
    }

    function getEnsNameMatch(address ens,address reverse, address who, uint256 coinType, string memory domain)
    public
    view
    returns (string memory)
    {
        string memory name = getReverseNameByAddress(ens, reverse, who);
        if(bytes(name).length == 0) {
            return '';
        }
        if(bytes(domain).length > 0) {
            name = string(abi.encodePacked(name, domain));
        }
        bytes32 node;
        address resolvedAddr;
        (resolvedAddr, node) = getAddrOfName(ens, reverse, name, coinType);
        if (resolvedAddr == who) {
            return name;
        }
        return '';
    }

    function matchNames(address ens, address reverse, address[] memory addrArr, string memory domain)
    public
    view
    returns (string[] memory)
    {
        string[] memory ret = new string[](addrArr.length);
        for(uint256 i=0; i<addrArr.length; i++) {
            ret[i] = getEnsNameMatch(ens, reverse, addrArr[i], domain);
        }
        return ret;
    }

    function matchNames(address ens, address reverse, address[] memory addrArr, uint256 coinType, string memory domain)
    public
    view
    returns (string[] memory)
    {
        string[] memory ret = new string[](addrArr.length);
        for(uint256 i=0; i<addrArr.length; i++) {
            ret[i] = getEnsNameMatch(ens, reverse, addrArr[i], coinType, domain);
        }
        return ret;
    }

    function readBytes20(bytes memory self, uint256 idx)
    internal
    pure
    returns (bytes20 ret)
    {
        require(idx + 20 <= self.length);
        assembly {
            ret := and(
            mload(add(add(self, 32), idx)),
            0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF000000000000000000000000
            )
        }
    }
}