const lodash = require('lodash')

const internalContracts = {
  AdminControl: '0x0888000000000000000000000000000000000000',
  SponsorWhitelistControl: '0x0888000000000000000000000000000000000001',
  Staking: '0x0888000000000000000000000000000000000002',
  ConfluxContext: '0x0888000000000000000000000000000000000004',
  PoSRegister: '0x0888000000000000000000000000000000000005',
  CrossSpaceCall: '0x0888000000000000000000000000000000000006',
  ParamsControl: '0x0888000000000000000000000000000000000007',
}

export const CONST = {
  // https://www.lihaoyi.com/post/BuildyourownCommandLinewithANSIescapecodes.html
  CL: '\u001b[2K', // CLEAR line
  TX_STATUS: {
    SUCCESS: 0,
    FAILED: 1,
  },

  TRACE_TYPE: {
    CREATE: 'create',
    CALL: 'call',
    CREATE_RESULT: 'create_result',
    CALL_RESULT: 'call_result',
    INTERNAL_TRANSFER_ACTION: 'internal_transfer_action',
  },

  /**
   * epochNumber label
   *
   * - `LATEST_MINED` 'latest_mined': latest epoch.
   * - `LATEST_STATE` 'latest_state': latest state, about 5 epoch less then `LATEST_MINED`
   * - `LATEST_CONFIRMED` 'latest_confirmed': latest epoch which confirmation risk less 1e-8.
   * - `LATEST_CHECKPOINT` 'latest_checkpoint': latest check point epoch.
   * - `EARLIEST` 'earliest': earliest epoch number, same as 0.
   */
  EPOCH_NUMBER: {
    LATEST_MINED: 'latest_mined',
    LATEST_STATE: 'latest_state',
    LATEST_CONFIRMED: 'latest_confirmed',
    LATEST_CHECKPOINT: 'latest_checkpoint',
    EARLIEST: 'earliest',
  },

  TX_TYPE: {
    ALL: 'all',
    IN: 'incoming',
    OUT: 'outgoing',
    FAIL: 'fail',
    CREATE: 'create',
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

  ZERO_ADDRESS: '0x0000000000000000000000000000000000000000',
  FOUR_YEAR_UNLOCK: '0x83bf953c8b687f0d1b8d2243a3e0654ec1f70d1b',
  TWO_YEAR_UNLOCK: '0x8ff21aed4e3d6e59594b25ad2d97aae2be33e52a',

  POSITION_IMPLEMENTATION_SLOT: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',
  //This is the keccak-256 hash of "org.zeppelinos.proxy.implementation",
  IMPLEMENTATION_SLOT_OZ: '0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3',
  // keccak256("PROXIABLE")
  IMPLEMENTATION_SLOT_EIP1822: '0xc5f16f0fcc639fa48a6947836d9850f504798523bf8c9a3a87d5876cf622bcf7',
  POSITION_BEACON_SLOT: '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50',
  ZERO_VALUE_IN_SLOT: '0x0000000000000000000000000000000000000000000000000000000000000000',

  CODEHASH_NO_BYTECODE: '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',

  INTERNAL_CONTRACT_MAP: internalContracts,
  INTERNAL_CONTRACT: lodash.values(internalContracts),

  LICENSE: {
    '1': {code: 'None', desc: 'No License'},
    '2': {code: 'Unlicense', desc: 'The Unlicense'},
    '3': {code: 'MIT', desc: 'MIT License'},
    '4': {code: 'GNU_GPLv2', desc: 'GNU General Public License v2.0'},
    '5': {code: 'GNU_GPLv3', desc: 'GNU General Public License v3.0'},
    '6': {code: 'GNU_LGPLv2_1', desc: 'GNU Lesser General Public License v2.1'},
    '7': {code: 'GNU_LGPLv3', desc: 'GNU Lesser General Public License v3.0'},
    '8': {code: 'BSD_2_Clause', desc: 'BSD 2-clause "Simplified" license'},
    '9': {code: 'BSD_3_Clause', desc: 'BSD 3-clause "New" Or "Revised" license*'},
    '10': {code: 'MPL_2_0', desc: 'Mozilla Public License 2.0'},
    '11': {code: 'OSL_3_0', desc: 'Open Software License 3.0'},
    '12': {code: 'Apache_2_0', desc: 'Apache 2.0'},
    '13': {code: 'GNU_AGPLv3', desc: 'GNU Affero General Public License'},
    '14': {code: 'BSL_1_1', desc: 'Business Source License'},
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

  MATCH_STATUS: {
    INTERNAL_CONTRACT: {matchCode: 200, matchDesc: 'internal-contract'},
    DEPLOYED_FULL: {matchCode: 201, matchDesc: 'deployed-full'},
    DEPLOYED_PARTIAL: {matchCode: 202, matchDesc: 'deployed-partial'},
    CREATION_FULL: {matchCode: 203, matchDesc: 'creation-full'},
    CREATION_PARTIAL: {matchCode: 204, matchDesc: 'creation-partial'},
    SIMILAR: {matchCode: 205, matchDesc: 'similar-match'},
    NOT_MATCH: {matchCode: 301, matchDesc: 'not-match'},
    CODE_NOT_FOUND: {matchCode: 401, matchDesc: 'code-not-found'},
    ERROR: {matchCode: 501, matchDesc: 'error'},
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
        GET_MINED_BLOCKS: 'getminedblocks',
        BALANCE_HISTORY: 'balancehistory',
        TOKEN_BALANCE: 'tokenbalance',
        TOKEN_BALANCE_HISTORY: 'tokenbalancehistory',
      }
    },
    CONTRACT: {
      module: 'contract',
      action: {
        GET_ABI: 'getabi',
        GET_SOURCECODE: 'getsourcecode',
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
    TOKEN: {
      module: 'token',
      action: {
        TOKEN_INFO: 'tokeninfo',
      }
    },
    STATS: {
      module: 'stats',
      action: {
        TOKEN_SUPPLY: 'tokensupply',
        TOKEN_SUPPLY_HISTORY: 'tokensupplyhistory',
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
    storagePointProp: {1029: 79016145, 1: 129134779}, // CIP-107
  },

  NETWORKS_CIP1559_ENABLED: [1029, 1030, 1, 71],

  CHAIN_INFO: {
    '1029': {      isEvm: false,      EPOCH_CIP1559: 101900000,
      C_ANNOUNCE: '0x81bbe80b1282387e19d7e1a57476869081c7d965',
      C_META: '0x8cb5b0e8a80fa62b2dc500219b4ebc386cb5fa70',
    },
    '1030': {      isEvm: true,       EPOCH_CIP1559: 101900000,
      C_ANNOUNCE: '0xdf07c798e70138ca6963ea0db3226e124db59ddd',
      C_META: '0x4a90f705ce108de778a0a5f20dfad2c0b7077316',
    },
    '1':    {      isEvm: false,      EPOCH_CIP1559: 175600000,
      C_ANNOUNCE: '0x81bbe80b1282387e19d7e1a57476869081c7d965',
      C_META: '0x8396a5771e1efb2767519a10dec97d9aaafab1d1',
    },
    '71':   {      isEvm: true,       EPOCH_CIP1559: 175600000,
      C_ANNOUNCE: '0x623a0340bd4b0817379c8482c92dd26fb8c5316d',
      C_META: '0x96c326866db1b879b2a25be4104fd1d2a7ffb108',
    },
    '8888':    {      isEvm: false,      EPOCH_CIP1559: 587382,
      C_ANNOUNCE: '0x81bbe80b1282387e19d7e1a57476869081c7d965', // placeholder
      C_META: '0x8396a5771e1efb2767519a10dec97d9aaafab1d1', // placeholder
    },
    '8889':   {      isEvm: true,       EPOCH_CIP1559: 587382,
      C_ANNOUNCE: '0x623a0340bd4b0817379c8482c92dd26fb8c5316d', // placeholder
      C_META: '0x96c326866db1b879b2a25be4104fd1d2a7ffb108', // placeholder
    },
  },

  EIP165_INTERFACE_ID: {
    ERC721: [0x80, 0xac, 0x58, 0xcd],
    ERC1155: [0xd9, 0xb6, 0x7a, 0x26],
  },
};
