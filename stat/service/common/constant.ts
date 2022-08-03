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
  },

  ZERO_ADDRESS: '0x0000000000000000000000000000000000000000',
  FOUR_YEAR_UNLOCK: '0x83bf953c8b687f0d1b8d2243a3e0654ec1f70d1b',
  TWO_YEAR_UNLOCK: '0x8ff21aed4e3d6e59594b25ad2d97aae2be33e52a',

  POSITION_IMPLEMENTATION_SLOT: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',
  POSITION_BEACON_SLOT: '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50',
  ZERO_VALUE_IN_SLOT: '0x0000000000000000000000000000000000000000000000000000000000000000',

  CODEHASH_NO_BYTECODE: '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',

  INTERNAL_CONTRACT: [
    '0x0888000000000000000000000000000000000000', // AdminControl
    '0x0888000000000000000000000000000000000001', // SponsorWhitelistControl
    '0x0888000000000000000000000000000000000002', // Staking
    '0x0888000000000000000000000000000000000003', //
    '0x0888000000000000000000000000000000000004', // ConfluxContext
    '0x0888000000000000000000000000000000000005', // PoSRegister
    '0x0888000000000000000000000000000000000006', // CrossSpaceCall
  ],

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

  TASK_STATUS: {
    SUBMITTED: 20,
    PROCESSING: 21,
    DONE: 22,
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

  /*ERROR: {
    // common error
    ParameterError:{ code: 10001, name: 'ParameterError' },
    PermissionsError: { code: 10403, name: 'PermissionsError' },
    AssertError: { code: 10501, name: 'AssertError' },
    ApiBusyError: { code: 10503, name: 'ApiBusyError' },

    // network error
    UnknowError: { code: 20000, name: 'UnknownError'},
    ResponseDataParsingError: { code: 20001, name: 'ResponseDataParsingError'},
    RequestTimeout: { code: 20002, name: 'RequestTimeout'},
    RequestAbort: { code: 20003, name: 'RequestAbort'},
    NetworkError: { code: 20004, name: 'NetworkError'},

    // RPC error
    RPCCallError: { code: 30001, name: 'RPCCallError'},

    // announce error
    AnnounceTooLongError: { code: 40414, name: 'AnnounceTooLongError' },
    SendAnnounceError: { code: 40400, name: 'SendAnnounceError' },
    AnnouncementNotExistError: { code: 40404, name: 'AnnouncementNotExistError' },

    // NFT error
    QueryNFTError: { code: 50300, name: 'Failed to query NFT' },
    CallNFTContractError: { code: 50301, name: 'Failed to call NFT contract' },
    QueryNFTMetadataError: { code: 50302, name: 'Failed to query NFT metadata' },
    ParseNFTMetadataError: { code: 50303, name: 'Failed to parse NFT metadata' },
    QueryNFTLocalNameError: { code: 50304, name: 'Failed to query NFT local name' },

    // contract error
    QueryCreationDataError: { code: 50403, name: 'QueryCreationDataError' },
    ContractNameError: { code: 50404, name: 'ContractNameError' },

    // token error
    QueryTokenError: { code: 50500, name: 'QueryTokenError' },
    DetectedAsTokenError: { code: 50501, name: 'Contract not detected as a token'},

    // verify error
    CompilerError: { code: 50600, name: 'CompilerError' },
    ContractDecompileError: { code: 50601, name: 'ContractDecompileError' },
    ExtractMetadataError: { code: 50602, name: 'ExtractMetadataError' },

    // trace error
    TraceParsingError: { code: 60002, name: 'TraceParsingError'},

    BadRequest: { code: 400, name: 'BadRequest'},
    Unauthorized: { code: 401, name: 'Unauthorized'},
    Forbidden: { code: 403, name: 'Forbidden'},
    NotFound: { code: 404, name: 'NotFound'},
    MethodNotAllowed: { code: 405, name: 'MethodNotAllowed'},
    InternalServerError: { code: 500, name: 'InternalServerError'},
    NotImplemented: { code: 501, name: 'NotImplemented'},
    BadGateway: { code: 502, name: 'BadGateway'},
    ServiceUnavailable: { code: 503, name: 'ServiceUnavailable'},
    GatewayTimeout: { code: 504, name: 'GatewayTimeout'},
  },*/

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
};
