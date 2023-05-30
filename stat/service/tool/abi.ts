module.exports = [
  // --------------------------------- Method ----------------------------------
  {
    type: 'function',
    name: 'name',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
  {
    type: 'function',
    name: 'symbol',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
  {
    type: 'function',
    name: 'decimals',
    inputs: [],
    outputs: [{ type: 'uint8' }],
  },
  {
    type: 'function',
    name: 'totalSupply',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'granularity',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  }, // 777
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_owner",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "_spender",
        "type": "address"
      }
    ],
    "name": "allowance",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "remaining",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'accountCount',
    outputs: [{ type: 'uint256' }],
  }, // cXXX Token
  {
    type: 'function',
    name: 'announce',
    inputs: [
      {
        type: 'tuple[]',
        components: [{ name: 'key', type: 'bytes' }, { name: 'value', type: 'bytes' }],
      },
    ],
    outputs: [],
  }, // Announcement
  {
    type: 'function',
    name: 'isToken',
    inputs: [{ type: 'address' }],
    outputs: [{ type: 'bool' }],
  }, // Custodian
  {
    type: 'function',
    name: 'getInterfaceImplementer',
    inputs: [
      { type: 'address', name: 'addr' },
      { type: 'bytes32', name: 'interfaceHash' },
    ],
    outputs: [{ type: 'address' }],
  }, // 1820
  // --------------------------------- Event ----------------------------------
  {
    anonymous: false,
    type: 'event',
    name: 'Announce',
    inputs: [
      { type: 'address', name: 'announcer', indexed: true },
      { type: 'bytes', name: 'keyHash', indexed: true },
      { type: 'bytes', name: 'key' },
      { type: 'bytes', name: 'value' },
    ],
  }, // Announcement
  {
    "anonymous": false,
    "inputs": [
      {"indexed": true, "internalType": "address",   "name": "owner", "type": "address"  },
      {"indexed": true,"internalType": "address", "name": "spender", "type": "address" },
      {"indexed": false,"internalType": "uint256", "name": "value","type": "uint256" } // token id for 721 or amount for 20
    ],
    "name": "Approval", // 20 and 721
    "type": "event"
  },
  {
    type: 'event',
    name: 'Transfer',
    anonymous: false,
    inputs: [
      { type: 'address', name: 'from', indexed: true },
      { type: 'address', name: 'to', indexed: true },
      { type: 'uint256', name: 'value' },
    ],
  }, // 20
  // { // XXX: conflict with ERC20
  //   type: 'event',
  //   name: 'Transfer',
  //   anonymous: false,
  //   inputs: [
  //     { type: 'address', name: 'from', indexed: true },
  //     { type: 'address', name: 'to', indexed: true },
  //     { type: 'uint256', name: 'tokenId', indexed: true },
  //   ],
  // }, // 721
  {
    "inputs": [
      {
        "internalType": "uint256","name": "tokenId","type": "uint256"
      }
    ],
    "name": "ownerOf",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "owner",
        "type": "address"
      }
    ],
    "name": "balanceOf",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "_tokenId",
        "type": "uint256"
      }
    ],
    "name": "getApproved", // 721
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_owner",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "_operator",
        "type": "address"
      }
    ],
    "name": "isApprovedForAll", // 721 and 1155
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    anonymous: false,
    type: 'event',
    name: 'Sent',
    inputs: [
      { type: 'address', name: 'operator', indexed: true },
      { type: 'address', name: 'from', indexed: true },
      { type: 'address', name: 'to', indexed: true },
      { type: 'uint256', name: 'value' },
      { type: 'bytes', name: 'data' },
      { type: 'bytes', name: 'operatorData' },
    ],
  }, // 777
  {
    type: 'event',
    name: 'TransferSingle',
    anonymous: false,
    inputs: [
      { type: 'address', name: 'operator', indexed: true },
      { type: 'address', name: 'from', indexed: true },
      { type: 'address', name: 'to', indexed: true },
      { type: 'uint256', name: 'tokenId' },
      { type: 'uint256', name: 'value' },
    ],
  }, // 1155
  {
    type: 'event',
    name: 'TransferBatch',
    anonymous: false,
    inputs: [
      { type: 'address', name: 'operator', indexed: true },
      { type: 'address', name: 'from', indexed: true },
      { type: 'address', name: 'to', indexed: true },
      { type: 'uint256[]', name: 'tokenIdArray' },
      { type: 'uint256[]', name: 'valueArray' },
    ],
  }, // 1155
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "account",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "operator",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bool",
        "name": "approved",
        "type": "bool"
      }
    ],
    "name": "ApprovalForAll",
    "type": "event"
  },
  {
    type: 'event',
    name: 'InterfaceImplementerSet',
    anonymous: false,
    inputs: [
      { type: 'address', name: 'addr', indexed: true },
      { type: 'bytes32', name: 'interfaceHash', indexed: true },
      { type: 'address', name: 'implementer', indexed: true },
    ],
  }, // 1820
  {
    type: 'event',
    name: 'ManagerChanged',
    anonymous: false,
    inputs: [
      { type: 'address', name: 'addr', indexed: true },
      { type: 'address', name: 'manager', indexed: true },
    ],
  }, // 1820
  {
    inputs:[
      {
        internalType:'bytes4',
        name:'interfaceId',
        type:'bytes4'
      }
    ],
    name:'supportsInterface',
    outputs:[
      {
        internalType:'bool',
        name:'',
        type:'bool'
      }
    ],
    stateMutability:'view',
    type:'function'
  }, // 165
  {
    inputs: [],
    name: 'implementation',
    outputs: [
      {
        internalType: 'address',
        name: '',
        type: 'address'
      }
    ],
    stateMutability: 'view',
    type: 'function'
  }, // beacon
  {
    inputs: [
      { internalType: 'address', name: 'account', type: 'address' },
      { internalType: 'address[]', name: 'tokens', type: 'address[]' },
    ],
    name: 'getBalances',
    outputs: [{ internalType: 'uint256[]', name: '', type: 'uint256[]' }],
    stateMutability: 'view',
    type: 'function',
  }, // scan util
];
