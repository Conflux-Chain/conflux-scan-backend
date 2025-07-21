const { CONST: { EPOCH_NUMBER } } = require('js-conflux-sdk');

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

  TX_EIP_TYPE: {
    0: 'Legacy',
    1: 'EIP-2930',
    2: 'EIP-1559',
    4: 'EIP-7702',
  },
};
