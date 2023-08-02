pragma solidity ^0.8.4;

import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";

abstract contract MetadataRole is AccessControlEnumerable {

    mapping(address => string) private _roleMemberNames;

    struct RoleInfo {
        bytes32 hash;
        MemberInfo[] members;
    }

    struct MemberInfo {
        address addr;
        string name;
    }

    function grantRole(bytes32 role, address account, string memory name) public virtual onlyRole(getRoleAdmin(role)) {
        _grantRole(role, account, name);
    }

    function _setupRole(bytes32 role, address account, string memory name) internal virtual {
        _grantRole(role, account, name);
    }

    function _grantRole(bytes32 role, address account, string memory name) internal virtual {
        super._grantRole(role, account);
        _roleMemberNames[account] = name;
    }

    function _revokeRole(bytes32 role, address account) internal override virtual {
        super._revokeRole(role, account);
        delete _roleMemberNames[account];
    }

    function listRoleMembers(bytes32 role) public view returns (RoleInfo memory info){
        uint count = getRoleMemberCount(role);
        MemberInfo[] memory members = new MemberInfo[](count);
        for(uint i=0; i<count; i++) {
            address addr = getRoleMember(role, i);
            string memory name = _roleMemberNames[addr];
            members[i] = MemberInfo(addr, name);
        }
        info = RoleInfo(role, members);
    }
}