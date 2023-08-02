pragma solidity ^0.8.4;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";
import "@confluxfans/contracts/InternalContracts/InternalContractsHandler.sol";

import "./MetadataRole.sol";

contract AddressMetadata is
MetadataRole,
Initializable,
InternalContractsHandler
{
    using Math for uint256;
    using EnumerableMap for EnumerableMap.AddressToUintMap;

    struct NameTag {
        address addr;
        string name;
        string website;
        uint256 auditTime;
    }
    struct Labels {
        address addr;
        string[] labelArray;
        uint256 auditTime;
    }

    bytes32 public constant AUDIT_ROLE = keccak256("AUDIT_ROLE");
    mapping (address => NameTag)  public nameTagMapping;
    mapping (address => Labels) public labelsMapping;
    EnumerableMap.AddressToUintMap internal nameTagUsers;
    EnumerableMap.AddressToUintMap internal labelUsers;

    modifier onlyAuditRole() {
        require(hasRole(AUDIT_ROLE, _msgSender()), "AddressMetadata: AUDIT_ROLE required");
        _;
    }

    event NameTagChanged(address indexed auditor, address indexed addr, string oldNameTag, string oldWebsite, string newNameTag, string newWebsite);
    event LabelChanged(address indexed auditor, address indexed addr, string oldLabel, string newLabel);

    constructor() {
        _disableInitializers();
    }

    function initialize() public initializer {
        _setupRole(DEFAULT_ADMIN_ROLE, _msgSender(), "metadata-admin");
        _setupRole(AUDIT_ROLE, _msgSender(), "metadata-admin");
    }

    function addNameTag(address addr, string memory name, string memory website)
    public
    virtual
    onlyAuditRole
    {
        require(bytes(name).length != 0, "AddressMetadata: nameTag is null, please provide it");
        require(bytes(website).length != 0, "AddressMetadata: website is null, please provide it");

        NameTag storage nameTag = nameTagMapping[addr];
        require(bytes(nameTag.name).length == 0, "AddressMetadata: nameTag has been set already");
        require(bytes(nameTag.website).length == 0, "AddressMetadata: website has been set already");

        nameTag.name = name;
        nameTag.website = website;
        nameTag.auditTime = block.timestamp;
        nameTagUsers.set(addr, block.timestamp);
        emit NameTagChanged(_msgSender(), addr, "", "", name, website);
    }

    function updateNameTag(address addr, string memory name, string memory website)
    public
    virtual
    onlyAuditRole
    {
        require(bytes(name).length != 0, "AddressMetadata: nameTag is null, please provide it");
        require(bytes(website).length != 0, "AddressMetadata: website is null, please provide it");

        NameTag storage nameTag = nameTagMapping[addr];
        string memory oldName = nameTag.name;
        string memory oldWebsite = nameTag.website;
        nameTag.name = name;
        nameTag.website = website;
        nameTag.auditTime = block.timestamp;
        nameTagUsers.set(addr, block.timestamp);
        emit NameTagChanged(_msgSender(), addr, oldName, oldWebsite, name, website);
    }

    function deleteNameTag(address addr)
    public
    virtual
    onlyAuditRole
    {
        NameTag storage nameTag = nameTagMapping[addr];
        string memory oldName = nameTag.name;
        string memory oldWebsite = nameTag.website;

        delete nameTagMapping[addr];
        nameTagUsers.remove(addr);
        emit NameTagChanged(_msgSender(), addr, oldName, oldWebsite, "", "");
    }

    function listNameTags(uint256 offset, uint256 limit)
    public
    view
    virtual
    returns (uint256, NameTag[] memory)
    {
        uint256 total = nameTagUsers.length();
        if (offset >= total) {
            return (total, new NameTag[](0));
        }

        uint256 end = total.min(offset + limit);
        NameTag[] memory result = new NameTag[](end - offset);

        for (uint256 i = offset; i < end; i++) {
            (address addr,) = nameTagUsers.at(i);
            NameTag memory nameTag = nameTagMapping[addr];
            result[i - offset] = NameTag(addr, nameTag.name, nameTag.website, nameTag.auditTime);
        }

        return (total, result);
    }

    function addLabel(address addr, string memory label)
    public
    virtual
    onlyAuditRole
    {
        string[] storage labels = labelsMapping[addr].labelArray;
        (bool isExist,) = findLabel(labels, label);
        require(!isExist, "AddressMetadata: label to add exists already");

        labels.push(label);
        labelUsers.set(addr, block.timestamp);
        emit LabelChanged(_msgSender(), addr, "", label);
    }

    function updateLabel(address addr, string memory oldLabel, string memory newLabel)
    public
    virtual
    onlyAuditRole
    {
        string[] storage labels = labelsMapping[addr].labelArray;
        (bool isExist, uint index) = findLabel(labels, oldLabel);
        require(isExist, "AddressMetadata: label to update not exists");

        labels[index] = newLabel;
        labelUsers.set(addr, block.timestamp);
        emit LabelChanged(_msgSender(), addr, oldLabel, newLabel);
    }

    function deleteLabel(address addr, string memory label)
    public
    virtual
    onlyAuditRole
    {
        string[] storage labels = labelsMapping[addr].labelArray;
        (bool isExist, uint index) = findLabel(labels, label);
        require(isExist, "AddressMetadata: label to delete not exists");

        if(labels.length == 1){
            delete labelsMapping[addr];
            labelUsers.remove(addr);
        } else{
            labels[index] = labels[labels.length - 1];
            labels.pop();
            labelUsers.set(addr, block.timestamp);
        }
        emit LabelChanged(_msgSender(), addr, label, "");
    }

    function findLabel(string[] memory labels, string memory label) internal view virtual returns(bool, uint){
        for(uint i=0; i< labels.length; i++) {
            string memory l = labels[i];
            if(keccak256(abi.encodePacked(label)) == keccak256(abi.encodePacked(l))) {
                return (true, i);
            }
        }
        return (false, 0);
    }

    function listLabels(uint256 offset, uint256 limit)
    public
    view
    virtual
    returns (uint256, Labels[] memory)
    {
        uint256 total = labelUsers.length();
        if (offset >= total) {
            return (total, new Labels[](0));
        }

        uint256 end = total.min(offset + limit);
        Labels[] memory result = new Labels[](end - offset);

        for (uint256 i = offset; i < end; i++) {
            (address addr,) = labelUsers.at(i);
            Labels memory labels = labelsMapping[addr];
            result[i - offset] = Labels(addr, labels.labelArray, labels.auditTime);
        }

        return (total, result);
    }
}
