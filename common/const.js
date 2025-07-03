const { CONST: { EPOCH_NUMBER }, format } = require('js-conflux-sdk');
const { KEY_BLOCK_QUERY_RDB_SWITCH, KEY_TX_QUERY_RDB_SWITCH, KEY_TRANSFER_QUERY_RDB_SWITCH } = require('../stat/model/KV');

module.exports = {
  EPOCH_NUMBER,
  LIST_LIMIT: 1000,
  CFX_DECIMALS: 18,

  ANNOUNCE_MAX_SIZE: 150 * 1000, // in bytes

  NULL_ADDRESS: '0x0000000000000000000000000000000000000000',
  FULL_ADDRESS: '0xffffffffffffffffffffffffffffffffffffffff',
  FOUR_YEAR_UNLOCK: '0x83bf953c8b687f0d1b8d2243a3e0654ec1f70d1b',
  TWO_YEAR_UNLOCK: '0x8ff21aed4e3d6e59594b25ad2d97aae2be33e52a',
  ERC1820_ADDRESS: '0x88887ed889e776bcbe2f0f9932ecfabcdfcd1820',

  GENESIS_TX_TO_CONTRACT: {
    1029: {
      '0x2952a64d3afa6d39310c4928860abcd6bc097342dcc1b271b52f7809fd63f228': '0x8a3a92281df6497105513b18543fd3b60c778e40',
      '0x6e425111b0c55c6aa75cf6983501cd782e5c9e1dbf7837dd09906a2f93fb1b3d': '0x8ff21aed4e3d6e59594b25ad2d97aae2be33e52a',
      '0x686839c2163ceb7c3542f810640a8adfa8c9d7b1e2f0567e601a8631468081bb': '0x83bf953c8b687f0d1b8d2243a3e0654ec1f70d1b',
      '0xcb95bac3257af0809012738d1b94f67451d1528e8e32ddb92952c76fff271625': '0x821abe3c0d1e0d5943acd65257fd7a20ad297176',
      '0x77801d4eab362c022ec05bfb23ea54c0562fb224316108aede41b909588fab70': '0x8e96e5866c03b2d12fac6d2378a87c140f3001f5',
      '0x9dcb7d851ede5c0394310e05b10139e994fb21a10226a95b6765d2c8a3d4f4b2': '0x8fb79782e14c082bfbb91692bf071187866007d2',
      '0xc2e77edbbf359d23775fa3910761cf89abeb920cbec071f7c9a07dec43083ef6': '0x84c3653218ffd7ab44918f70228b144aaf7d80f5',
    },
    1:{
      '0x691007a83c57ccf7c248d4db72332ace9c9f72e64c023eb9afaf3227335e397b': '0x8a3a92281df6497105513b18543fd3b60c778e40',
      '0x1f57de048519303c6ece8d9dfc38d531558d8715103945d5db66bb0cfb881b05': '0x8ff21aed4e3d6e59594b25ad2d97aae2be33e52a',
      '0x4e93173b112bd1c6ed03e5502467c0cf513dc425b59fe07f09669e5f6167d154': '0x83bf953c8b687f0d1b8d2243a3e0654ec1f70d1b',
      '0x5666efdd98185249696a5d47b6390f2d38795cf9612eb786505ba626d49a43a8': '0x821abe3c0d1e0d5943acd65257fd7a20ad297176',
      '0x261b30b6c5329c562da773564b6ef0e153981990f18a0ee94d087bf02ec17377': '0x8e96e5866c03b2d12fac6d2378a87c140f3001f5',
      '0xda8fd6dbd1812dd0d67c8c1d2328666b0416011bc1e936eb3cafc0b4bd767c36': '0x8fb79782e14c082bfbb91692bf071187866007d2',
      '0xc15b3d55335b6f0eda2ec8699902f18e0ae7283b36d79199241d868156dd68e5': '0x84c3653218ffd7ab44918f70228b144aaf7d80f5',
    }
  },

  TX_STATUS: {
    SUCCESS: 0,
    FAILED: 1,
  },

  TX_TYPE: {
    ALL: 'all',
    IN: 'incoming',
    OUT: 'outgoing',
    FAIL: 'fail',
    CREATE: 'create',
  },

  TRACE_TYPE: {
    CREATE: 'create',
    CALL: 'call',
    CREATE_RESULT: 'create_result',
    CALL_RESULT: 'call_result',
    INTERNAL_TRANSFER_ACTION: 'internal_transfer_action',
    MINER_REWARD: 'miner_reward', // virtual for display
  },

  TRANSFER_TYPE: {
    CFX: 'CFX',
    ERC20: 'ERC20',
    ERC721: 'ERC721',
    ERC777: 'ERC777',
    ERC1155: 'ERC1155',
    ERC3525: 'ERC3525',
  },

  INTERNAL_CONTRACT: [
    '0x0888000000000000000000000000000000000000',
    '0x0888000000000000000000000000000000000001',
    '0x0888000000000000000000000000000000000002',
    '0x0888000000000000000000000000000000000004',
    '0x0888000000000000000000000000000000000005',
    '0x0888000000000000000000000000000000000006',
    '0x0888000000000000000000000000000000000007',
  ],

  RDB_SWITCH: {
    KEY_BLOCK_QUERY_RDB_SWITCH,
    KEY_TX_QUERY_RDB_SWITCH,
    KEY_TRANSFER_QUERY_RDB_SWITCH,
  },

  COMPILER_TYPE: {
    SINGLE_FILE: 'solidity-single-file',
    STANDARD_JSON_INPUT: 'solidity-standard-json-input',
  },

/*  OPEN_SOURCE_LICENSE: {
    None: 'No License',
    Unlicense: 'The Unlicense',
    MIT: 'MIT License',
    GNU_GPLv2: 'GNU General Public License v2.0',
    GNU_GPLv3: 'GNU General Public License v3.0',
    GNU_LGPLv2_1: 'GNU Lesser General Public License v2.1',
    GNU_LGPLv3: 'GNU Lesser General Public License v3.0',
    BSD_2_Clause: 'BSD 2-clause "Simplified" license',
    BSD_3_Clause: 'BSD 3-clause "New" Or "Revised" license*',
    MPL_2_0: 'Mozilla Public License 2.0',
    OSL_3_0: 'Open Software License 3.0',
    Apache_2_0: 'Apache 2.0',
    GNU_AGPLv3: 'GNU Affero General Public License',
  },*/

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

  TX_EIP_TYPE: {
    0: 'Legacy',
    1: 'EIP-2930',
    2: 'EIP-1559',
    4: 'EIP-7702',
  },
};
