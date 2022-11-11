// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;
import '../registry/ENS.sol';
import '../resolvers/Resolver.sol';
import '../registry/IReverseRegistrar.sol';
import './ENSNamehash.sol';
import "hardhat/console.sol";
// put this file under  https://github.com/ensdomains/ens-contracts.git / contracts/utils
// then compile and get abi
contract EnsChecker {
    using ENSNamehash for bytes;
//    using ENSNamehash for string;
    function getReverseNameByAddress(address ens,address reverse, address who) public view returns (string memory) {
//    IReverseRegistrar(reverse).
        bytes32 node = IReverseRegistrar(reverse).node(who);
        address resolver = ENS(ens).resolver(node);
        console.log("reverse resolver is ", resolver);
        if (resolver == address(0)) {
            return '';
        }
        return Resolver(resolver).name(node);
    }
    function getAddrOfName(address ens,address reverse, string memory name
    )   public view returns (address resolvedAddr,bytes32 node) {
        bytes32 node = (bytes(name)).namehash();
        address resolver = ENS(ens).resolver(node);
//        console.log("forward resolver is ", resolver);
        if (resolver == address(0)) {
            return (address(0),node);
        }
        address resolvedAddr = Resolver(resolver).addr(node);
        return (resolvedAddr, node);
    }
    function getEnsNameMatch(address ens,address reverse, address who, string memory domain)  public view returns (string memory) {
        string memory name = getReverseNameByAddress(ens, reverse, who);
        if(bytes(domain).length > 0) {
            name = string(abi.encodePacked(name, domain));
        }
        bytes32 node;
        address resolvedAddr;
        (resolvedAddr, node) = getAddrOfName(ens, reverse, name);
//        console.log("forward name resolve to ", resolvedAddr);
        if (resolvedAddr == who) {
            return name;
        }
        return '';
    }
    function matchNames(address ens,address reverse, address[] memory addrArr, string memory domain)  public view returns (string[] memory) {
        string[] memory ret = new string[](addrArr.length);
        for(uint256 i=0; i<addrArr.length; i++) {
            ret[i] = getEnsNameMatch(ens, reverse, addrArr[i], domain);
        }
        return ret;
    }
}