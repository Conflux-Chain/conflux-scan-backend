module.exports = {
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

  INTERNAL_CONTRACT: [
    '0x0888000000000000000000000000000000000000',
    '0x0888000000000000000000000000000000000001',
    '0x0888000000000000000000000000000000000002',
    '0x0888000000000000000000000000000000000003',
    '0x0888000000000000000000000000000000000004',
    '0x0888000000000000000000000000000000000005',
  ],
};
