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
};
