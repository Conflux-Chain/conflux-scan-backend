import {EVM_RPC_URL} from "../../model/KV";
import {frontendConstant} from "./frontendConstant";

const lodash = require('lodash');
const { CONST: { EPOCH_NUMBER } } = require('js-conflux-sdk');
const AdminControl = require("../abi/AdminControl");
const SponsorWhitelistControl = require("../abi/SponsorWhitelistControl");
const Staking = require("../abi/Staking");
const ConfluxContext = require("../abi/ConfluxContext");
const PoSRegister = require("../abi/PoSRegister");
const CrossSpaceCall = require("../abi/CrossSpaceCall");
const ParamsControl = require("../abi/ParamsControl");
const ERC1820Registry = require("../abi/ERC1820Registry");

const INTERNAL = [
  {
    space: 'core',
    name: 'AdminControl',
    address: '0x0888000000000000000000000000000000000000',
    abi: JSON.stringify(AdminControl.abi),
    website: 'https://doc.confluxnetwork.org/docs/core/core-space-basics/internal-contracts',
    compilerVersion: 'v0.8.0+commit.c7dfd78e',
    optimization: '0',
    runs: 200,
  },
  {
    space: 'core',
    name: 'SponsorWhitelistControl',
    address: '0x0888000000000000000000000000000000000001',
    abi: JSON.stringify(SponsorWhitelistControl.abi),
    website: 'https://doc.confluxnetwork.org/docs/core/core-space-basics/internal-contracts',
    compilerVersion: 'v0.8.0+commit.c7dfd78e',
    optimization: '0',
    runs: 200,
  },
  {
    space: 'core',
    name: 'Staking',
    address: '0x0888000000000000000000000000000000000002',
    abi: JSON.stringify(Staking.abi),
    website: 'https://doc.confluxnetwork.org/docs/core/core-space-basics/internal-contracts',
    compilerVersion: 'v0.8.0+commit.c7dfd78e',
    optimization: '0',
    runs: 200,
  },
  {
    space: 'core',
    name: 'ConfluxContext',
    address: '0x0888000000000000000000000000000000000004',
    abi: JSON.stringify(ConfluxContext.abi),
    website: 'https://doc.confluxnetwork.org/docs/core/core-space-basics/internal-contracts',
    compilerVersion: 'v0.8.0+commit.c7dfd78e',
    optimization: '0',
    runs: 200,
  },
  {
    space: 'core',
    name: 'PoSRegister',
    address: '0x0888000000000000000000000000000000000005',
    abi: JSON.stringify(PoSRegister.abi),
    website: 'https://doc.confluxnetwork.org/docs/core/core-space-basics/internal-contracts',
    compilerVersion: 'v0.8.0+commit.c7dfd78e',
    optimization: '0',
    runs: 200,
  },
  {
    space: 'core',
    name: 'CrossSpaceCall',
    address: '0x0888000000000000000000000000000000000006',
    abi: JSON.stringify(CrossSpaceCall.abi),
    website: 'https://doc.confluxnetwork.org/docs/core/core-space-basics/internal-contracts',
    compilerVersion: 'v0.8.0+commit.c7dfd78e',
    optimization: '0',
    runs: 200,
  },
  {
    space: 'core',
    name: 'ParamsControl',
    address: '0x0888000000000000000000000000000000000007',
    abi: JSON.stringify(ParamsControl.abi),
    website: 'https://doc.confluxnetwork.org/docs/core/core-space-basics/internal-contracts',
    compilerVersion: 'v0.8.0+commit.c7dfd78e',
    optimization: '0',
    runs: 200,
  },
  {
    space: 'evm',
    name: 'ERC1820Registry',
    address: '0x1820a4b7618bde71dce8cdc73aab6c95905fad24',
    abi: JSON.stringify(ERC1820Registry.abi),
    website: 'https://github.com/Conflux-Chain/CIPs/blob/master/CIPs/cip-1820.md',
    compilerVersion: 'v0.5.11+commit.c082d0b4',
    optimization: '1',
    runs: 1000,
  }
]

const GENESIS = [
  {
    address: '0x8a3a92281df6497105513b18543fd3b60c778e40',
    name: 'Create2Factory',
    txHash: {
      1029: '0x2952a64d3afa6d39310c4928860abcd6bc097342dcc1b271b52f7809fd63f228',
      1: '0x691007a83c57ccf7c248d4db72332ace9c9f72e64c023eb9afaf3227335e397b',
    }
  },
  {
    address: '0x8ff21aed4e3d6e59594b25ad2d97aae2be33e52a',
    name: 'TwoYearUnlock',
    txHash: {
      1029: '0x6e425111b0c55c6aa75cf6983501cd782e5c9e1dbf7837dd09906a2f93fb1b3d',
      1: '0x1f57de048519303c6ece8d9dfc38d531558d8715103945d5db66bb0cfb881b05',
    }
  },
  {
    address: '0x83bf953c8b687f0d1b8d2243a3e0654ec1f70d1b',
    name: 'FourYearUnlock',
    txHash: {
      1029: '0x686839c2163ceb7c3542f810640a8adfa8c9d7b1e2f0567e601a8631468081bb',
      1: '0x4e93173b112bd1c6ed03e5502467c0cf513dc425b59fe07f09669e5f6167d154',
    }
  },
  {
    address: '0x821abe3c0d1e0d5943acd65257fd7a20ad297176',
    txHash: {
      1029: '0xcb95bac3257af0809012738d1b94f67451d1528e8e32ddb92952c76fff271625',
      1: '0x5666efdd98185249696a5d47b6390f2d38795cf9612eb786505ba626d49a43a8',
    }
  },
  {
    address: '0x8e96e5866c03b2d12fac6d2378a87c140f3001f5',
    txHash: {
      1029: '0x77801d4eab362c022ec05bfb23ea54c0562fb224316108aede41b909588fab70',
      1: '0xc15b3d55335b6f0eda2ec8699902f18e0ae7283b36d79199241d868156dd68e5',
    }
  },
  {
    address: '0x8fb79782e14c082bfbb91692bf071187866007d2',
    txHash: {
      1029: '0x9dcb7d851ede5c0394310e05b10139e994fb21a10226a95b6765d2c8a3d4f4b2',
      1: '0xda8fd6dbd1812dd0d67c8c1d2328666b0416011bc1e936eb3cafc0b4bd767c36',
    }
  },
  {
    address: '0x84c3653218ffd7ab44918f70228b144aaf7d80f5',
    txHash: {
      1029: '0xc2e77edbbf359d23775fa3910761cf89abeb920cbec071f7c9a07dec43083ef6',
      1: '0x691007a83c57ccf7c248d4db72332ace9c9f72e64c023eb9afaf3227335e397b',
    }
  },
]

const CODE_FORMAT = {
  SOLIDITY_SINGLE_FILE: {code: 'solidity-single-file', desc: 'Solidity (Single file)'},
  SOLIDITY_STANDARD_JSON_INPUT: {code: 'solidity-standard-json-input', desc: 'Solidity (Standard-json-input)'},
  VYPER_SINGLE_FILE: {code: 'vyper-single-file', desc: 'Vyper (Single file)'},
  VYPER_JSON: {code: 'vyper-json', desc: 'Vyper (Standard-json-input)'},
}

export const CONST = {
  CL: '\u001b[2K', // CLEAR line, https://www.lihaoyi.com/post/BuildyourownCommandLinewithANSIescapecodes.html
  LIST_LIMIT: 1000,
  ANNOUNCE_MAX_SIZE: 150 * 1000, // in bytes

  EPOCH_NUMBER,

  TX_TYPE: {
    ALL: 'all',
    IN: 'incoming',
    OUT: 'outgoing',
    FAIL: 'fail',
    CREATE: 'create',
  },

  TX_EIP_TYPE: {
    0: 'Legacy',
    1: 'EIP-2930',
    2: 'EIP-1559',
    4: 'EIP-7702',
  },

  TX_STATUS: {
    SUCCESS: 0,
    FAILED: 1,
  },

  TRANSFER_TYPE: {
    CFX: 'CFX',
    ERC20: 'ERC20',
    ERC721: 'ERC721',
    ERC777: 'ERC777',
    ERC1155: 'ERC1155',
    ERC3525: 'ERC3525',
    ALL: 'ALL'
  },

  ADDRESS_TRANSFER_TYPE: {
    TX: {code: 10, name: 'transaction' },
    CFX_IN_CALL: {code: 101, name: 'call'},
    CFX_IN_CREATE: {code: 102, name: 'create'},
    // Positive when address is toPocket, otherwise is negative. Only process the case in which the fromPocket/toPocket is balance/gas_payment
    CFX_IN_INTERNAL_BY_GAS_PAYMENT: {code: 103, name: 'gas_payment'},
    // Positive when address is toPocket, otherwise is negative. Only process the case in which the fromPocket/toPocket is balance/storage_collateral
    CFX_IN_INTERNAL_BY_STORAGE_COLLATERAL: {code: 104, name: 'storage_collateral'},
    // Positive when address is toPocket, otherwise is negative. Only process the case in which the fromPocket/toPocket is balance/sponsor_balance_for_gas
    CFX_IN_INTERNAL_BY_SPONSOR_GAS: {code: 105, name: 'sponsor_balance_for_gas'},
    // Positive when address is toPocket, otherwise is negative. Only process the case in which the fromPocket/toPocket is balance/sponsor_balance_for_collateral
    CFX_IN_INTERNAL_BY_SPONSOR_COLLATERAL: {code: 106, name: 'sponsor_balance_for_collateral'},
    // Positive when address is toPocket, otherwise is negative. Only process the case in which the fromPocket/toPocket is balance/staking_balance
    CFX_IN_INTERNAL_BY_STAKING: {code: 107, name: 'staking_balance'},
    // Positive when address is toPocket, otherwise is negative. Only process the case in which the fromPocket/toPocket is balance/balance
    CFX_IN_INTERNAL_BY_BALANCE: {code: 108, name: 'balance'},
    ERC20: {code: 20, name: 'transfer_20'},
    ERC721: {code: 21, name: 'transfer_721'},
    ERC1155: {code: 55, name: 'transfer_1155'},
  },

  TRACE_TYPE: {
    CREATE: 'create',
    CALL: 'call',
    CREATE_RESULT: 'create_result',
    CALL_RESULT: 'call_result',
    INTERNAL_TRANSFER_ACTION: 'internal_transfer_action',
    MINER_REWARD: 'miner_reward', // virtual for display
  },

  CODEHASH_NO_BYTECODE: '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
  REGEX_EIP1167_BYTECODE: new RegExp(/^0x363d3d373d3d3d363d73[0-9a-f]{40}5af43d82803e903d91602b57fd5bf3$/),

  ZERO_ADDRESS: '0x0000000000000000000000000000000000000000',
  FULL_ADDRESS: '0xffffffffffffffffffffffffffffffffffffffff',
  GENESIS_ADDRESS: '0x1949000000000000000000000000000000001001',
  FOUR_YEAR_UNLOCK: '0x83bf953c8b687f0d1b8d2243a3e0654ec1f70d1b',
  TWO_YEAR_UNLOCK: '0x8ff21aed4e3d6e59594b25ad2d97aae2be33e52a',
  ERC1820_ADDRESS: '0x88887ed889e776bcbe2f0f9932ecfabcdfcd1820',
  INTERNAL_CONTRACT: INTERNAL.filter((item: any) => item.space === 'core').map((item: any) => item.address),
  INTERNAL_CONTRACT_ALL: INTERNAL.map((item: any) => item.address),
  INTERNAL_NAME_CONTRACT_MAP: lodash.keyBy(INTERNAL, 'name'),
  INTERNAL_ADDR_CONTRACT_MAP: lodash.keyBy(INTERNAL, 'address'),
  GENESIS_CONTRACT: GENESIS.map((item: any) => item.address),
  GENESIS_ADDR_CONTRACT_MAP: lodash.keyBy(GENESIS, 'address'),
  GENESIS_TX_CONTRACT_MAP: GENESIS.reduce(
      (result, item) => (Object.values(item.txHash).forEach(hash => result[hash] = item.address), result), {}),

  POSITION_IMPLEMENTATION_SLOT: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',
  //This is the keccak-256 hash of "org.zeppelinos.proxy.implementation",
  IMPLEMENTATION_SLOT_OZ: '0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3',
  // keccak256("PROXIABLE")
  IMPLEMENTATION_SLOT_EIP1822: '0xc5f16f0fcc639fa48a6947836d9850f504798523bf8c9a3a87d5876cf622bcf7',
  POSITION_BEACON_SLOT: '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50',
  ZERO_VALUE_IN_SLOT: '0x0000000000000000000000000000000000000000000000000000000000000000',

  CONTRACT_CODE_FORMAT_INFO: CODE_FORMAT,
  CONTRACT_CODE_FORMATS: Object.values(CODE_FORMAT).map(f => f.code),
  CONTRACT_CODE_FORMATS_SOLIDITY: Object.values(CODE_FORMAT).map(f => f.code).filter(f => f.startsWith('solidity')),
  CONTRACT_CODE_FORMATS_VYPER: Object.values(CODE_FORMAT).map(f => f.code).filter(f => f.startsWith('vyper')),

  CONTRACT_LICENSE: {
    1: {code: 'None', desc: 'No License'},
    2: {code: 'Unlicense', desc: 'The Unlicense'},
    3: {code: 'MIT', desc: 'MIT License'},
    4: {code: 'GNU_GPLv2', desc: 'GNU General Public License v2.0'},
    5: {code: 'GNU_GPLv3', desc: 'GNU General Public License v3.0'},
    6: {code: 'GNU_LGPLv2_1', desc: 'GNU Lesser General Public License v2.1'},
    7: {code: 'GNU_LGPLv3', desc: 'GNU Lesser General Public License v3.0'},
    8: {code: 'BSD_2_Clause', desc: 'BSD 2-clause "Simplified" license'},
    9: {code: 'BSD_3_Clause', desc: 'BSD 3-clause "New" Or "Revised" license*'},
    10: {code: 'MPL_2_0', desc: 'Mozilla Public License 2.0'},
    11: {code: 'OSL_3_0', desc: 'Open Software License 3.0'},
    12: {code: 'Apache_2_0', desc: 'Apache 2.0'},
    13: {code: 'GNU_AGPLv3', desc: 'GNU Affero General Public License'},
    14: {code: 'BSL_1_1', desc: 'Business Source License'},
  },

  EVM_VERSION: [
    'homestead',
    'tangerineWhistle',
    'spuriousDragon',
    'byzantium',
    'constantinople',
    'petersburg',
    'istanbul',
    'berlin',
    'london',
    'paris',
    'shanghai',
    'cancun',
  ],

  LANGUAGE: {
    SOLIDITY: "Solidity",
    VYPER: "Vyper"
  },

  VYPER_SETTING_OPTIMIZE: ['gas', 'codesize', 'none', true, false],

  TASK_STATUS: {
    SUBMITTED: 20,
    PROCESSING: 21,
    DONE: 22,
  },

  NOTIFY_STATUS: {
    NEED_NOTIFY: 20,
    NOT_NEED_NOTIFY: 21,
    NOTIFIED: 22,
  },

  E_SPACE_OPENAPI: {
    ACCOUNT: {
      module: 'account',
      action: {
        BALANCE: 'balance',
        BALANCE_MULTI: 'balancemulti',
        TX_LIST: 'txlist',
        TX_LIST_INTERNAL: 'txlistinternal',
        TOKEN_TX: 'tokentx',
        TOKEN_NFT_TX: 'tokennfttx',
        TOKEN_1155_TX: 'token1155tx',
        GET_MINED_BLOCKS: 'getminedblocks',
        BALANCE_HISTORY: 'balancehistory',
        TOKEN_BALANCE: 'tokenbalance',
        TOKEN_BALANCE_HISTORY: 'tokenbalancehistory',
        ADDRESS_TOKEN_BALANCE: 'addresstokenbalance',
        ADDRESS_TOKEN_NFT_BALANCE: 'addresstokennftbalance',
        ADDRESS_TOKEN_NFT_INVENTORY: 'addresstokennftinventory',
      }
    },
    CONTRACT: {
      module: 'contract',
      action: {
        GET_ABI: 'getabi',
        GET_SOURCECODE: 'getsourcecode',
        GET_CONTRACT_CREATION: 'getcontractcreation',
        VERIFY_SOURCECODE: 'verifysourcecode',
        CHECK_VERIFY_STATUS: 'checkverifystatus',
        VERIFY_PROXY_CONTRACT: 'verifyproxycontract',
        CHECK_PROXY_VERIFICATION: 'checkproxyverification',
      }
    },
    TRANSACTION: {
      module: 'transaction',
      action: {
        GET_STATUS: 'getstatus',
        GET_TX_RECEIPT_STATUS: 'gettxreceiptstatus',
      }
    },
    BLOCK: {
      module: 'block',
      action: {
        GET_BLOCK_NO_BY_TIME: 'getblocknobytime',
      }
    },
    LOGS: {
      module: 'logs',
      action: {
        GET_LOGS: 'getLogs',
      }
    },
    TOKEN: {
      module: 'token',
      action: {
        TOKEN_HOLDER_LIST: 'tokenholderlist',
        TOKEN_HOLDER_COUNT: 'tokenholdercount',
        TOP_HOLDERS: 'topholders',
        TOKEN_INFO: 'tokeninfo',
      }
    },
    STATS: {
      module: 'stats',
      action: {
        CFX_SUPPLY: 'cfxsupply',
        CFX_PRICE: 'cfxprice',
        TOKEN_SUPPLY: 'tokensupply',
        TOKEN_SUPPLY_HISTORY: 'tokensupplyhistory',
        DAILY_BLOCK: 'dailyblkcount',
        DAILY_TX: 'dailytx',
        DAILY_TX_FEE: 'dailytxnfee',
        DAILY_NEW_ADDRESS: 'dailynewaddress',
        DAILY_AVG_HASHRATE: 'dailyavghashrate',
        DAILY_AVG_DIFFICULTY: 'dailyavgnetdifficulty',
        DAILY_AVG_BLOCKTIME: 'dailyavgblocktime',
        DAILY_AVG_GASLIMIT: 'dailyavggaslimit',
        DAILY_TOTAL_GASUSED: 'dailygasused',
        DAILY_AVG_GASPRICE: 'dailyavggasprice',
        DAILY_NETWORK_UTILIZATION: 'dailynetutilization',
      }
    },
  },

  DEPLOY_STATUS: {
    DEPLOYED: {status: 0, message: 'deployed'},
    NOT_DEPLOYED: {status: 1, message: 'not deployed'},
    ADMIN_DESTROYED: {status: 2, message: 'admin destroyed'},
    SELF_DESTRUCTED: {status: 3, message: 'self destructed'},
  },

  GAS_LIMIT_PROPORTION: {
    core: 0.9,
    evm: 0.5,
  },

  VOTE_PARAMS: {
    storagePointProp: {1029: 79016145, 1: 129134779, 8888: 79016145}, // CIP-107
  },

  NETWORKS_CIP1559_ENABLED: [1029, 1030, 1, 71, 8888, 8889],

  NETWORKS_CORE_SPACE: [1029, 1, 8888, 6666],

  WRAPPED_TOKENS: {
    1029: {
      wrappedCFX: "cfx:acg158kvr8zanb1bs048ryb6rtrhr283ma70vz70tx",
      wrappedBTC: "cfx:acbb225r9wc7a2kt1dz9gw0tuv5v1kgdjuh5akdh3t",
      wrappedUSDT: "cfx:acf2rcsh8payyxpg6xj7b0ztswwh81ute60tsw35j7",

    },
    1030:  {
      wrappedCFX: "0x14b2D3bC65e74DAE1030EAFd8ac30c533c976A9b",
      wrappedBTC: "0x1F545487c62e5ACfEa45dcAdd9c627361d1616D8",
      wrappedUSDT: "0xfe97E85d13ABD9c1c33384E796F10B73905637cE",
      wrappedUSDT0: "0xaf37E8B6C9ED7f6318979f56Fc287d76c30847ff",

    },
    1:  {
      wrappedCFX: "cfxtest:achs3nehae0j6ksvy1bhrffsh1rtfrw1f6w1kzv46t",
      wrappedBTC: 'cfxtest:acb9re0g2ggaywuszwfmjmfb8w45nf1d5ppzc3jndb',
      wrappedUSDT: "cfxtest:acepe88unk7fvs18436178up33hb4zkuf62a9dk1gv",
    },
    71: {
      wrappedCFX: "0x2ED3dddae5B2F321AF0806181FBFA6D049Be47d8",
      wrappedBTC: '0x54593e02c39aEFf52B166bd036797D2b1478de8D',
      wrappedUSDT: "0x7d682e65EFC5C13Bf4E394B8f376C48e6baE0355",
      wrappedUSDT0: "0x05D714465e24B7639a31eeB57D37396F889Df725",
    },
  },

  CHAIN_INFO: {
    '1029': {      isEvm: false,      EPOCH_CIP1559: 101900000,
      C_ANNOUNCE: '0x81bbe80b1282387e19d7e1a57476869081c7d965',
      C_META: '0x8cb5b0e8a80fa62b2dc500219b4ebc386cb5fa70',
    },
    '1030': {      isEvm: true,       EPOCH_CIP1559: 101900000,
      C_ANNOUNCE: '0xdf07c798e70138ca6963ea0db3226e124db59ddd',
      C_META: '0x4a90f705ce108de778a0a5f20dfad2c0b7077316',
      [EVM_RPC_URL]: 'https://evm.confluxrpc.com',
    },
    '1':    {      isEvm: false,      EPOCH_CIP1559: 175600000,
      C_ANNOUNCE: '0x81bbe80b1282387e19d7e1a57476869081c7d965',
      C_META: '0x8396a5771e1efb2767519a10dec97d9aaafab1d1',
    },
    '71':   {      isEvm: true,       EPOCH_CIP1559: 175600000,
      C_ANNOUNCE: '0x623a0340bd4b0817379c8482c92dd26fb8c5316d',
      C_META: '0x96c326866db1b879b2a25be4104fd1d2a7ffb108',
      [EVM_RPC_URL]: 'https://evmtestnet.confluxrpc.com',
    },
    '8888':    {      isEvm: false,      EPOCH_CIP1559: 587382,
      C_ANNOUNCE: '0x81bbe80b1282387e19d7e1a57476869081c7d965', // placeholder
      C_META: '0x8396a5771e1efb2767519a10dec97d9aaafab1d1', // placeholder
    },
    '8889':   {      isEvm: true,       EPOCH_CIP1559: 587382,
      C_ANNOUNCE: '0x623a0340bd4b0817379c8482c92dd26fb8c5316d', // placeholder
      C_META: '0x96c326866db1b879b2a25be4104fd1d2a7ffb108', // placeholder
      [EVM_RPC_URL]: 'https://net8889eth.confluxrpc.com',
    },
  },

  CHAINS_CROSS_SPACE_VERIFY: {
    "1029": [1030],
    "1030": [1029],
    "1029_ALL_OTHER_SPACE": [1030, 1, 71],
    "1030_ALL_OTHER_SPACE": [1029, 1, 71],
    "1": [71],
    "71": [1],
    "1_ALL_OTHER_SPACE": [71, 1029, 1030],
    "71_ALL_OTHER_SPACE": [1, 1029, 1030],
    "6666": [6667],
    "6667": [6666],
    "8888": [8889],
    "8889": [8888],
    "16661": [16602],
    "16602": [16661],
  },

  EIP165_INTERFACE_ID: {
    ERC721: [0x80, 0xac, 0x58, 0xcd],
    ERC1155: [0xd9, 0xb6, 0x7a, 0x26],
  },

  ENS: {
    1029: {
      ens: 'cfx:acemru7fu1u8brtyn3hrtae17kbcd4pd9uwbspvnnm',
      reverseRegistrar: 'cfx:acfarpzehntpre0thg8x7dp0ajw4ms328ps634v1zk',
      baseRegistrar: 'cfx:acg08bujp0kmsup1zk11c9mad7zd6648eybmv2kbha',
      ensChecker: 'cfx:acef1ym9m16fc94x29h0800k0ugnaj91sjjbm60hfh',
      reverseRecords: 'cfx:achsgpgs5dgpmgpj2zd87apj6js33c07pjth6k33mj',
      ensSubGraphUrl: 'https://thegraph.conflux123.xyz/subgraphs/name/graphprotocol/ens',
    },
  },

  SWAPPI_FACTORY_LIST: {
    1030: ["0xE2a6F7c0ce4d5d300F97aA7E125455f5cd3342F5"],
    71: ["0x36B83E0D41D1dd9C73a006F0c1cbC1F096E69E34"],
  },

  SWAPPI_NFT_POSITION_LIST: {
    1030: ["0xaaeA97033dFe8AEBDD9d4aE9D5856678B8F7e127"],
    71: ["0xdba7475F00deb72Bc80B16e8d742c86760c342fe"],
  },

  SWAPPI_NFT_POSITION_NAME_REPLACES: {
    vSwap: "WallFreeX",
  },

  PROXY_PATTERN: {
    BEACON_PROXY: "EIP-1967 Transparent Proxy",
    PROXY: "OpenZeppelin's Unstructured Storage",
  },

  FRONTEND_CONFIG: frontendConstant,
};
