const LogicError = require('koaflow/lib/util/LogicError').extend({ status: 600 });

module.exports = {
  LogicError,
  ParameterError: LogicError.extend({ name: 'ParameterError', code: 10001 }),
  PermissionsError: LogicError.extend({ name: 'PermissionsError', code: 10403 }),
  AssertError: LogicError.extend({ name: 'AssertError', code: 10501 }),
  ApiBusyError: LogicError.extend({ name: 'ApiBusyError', code: 10503 }),

  AnnounceTooLongError: LogicError.extend({ name: 'AnnounceTooLongError', code: 40414 }),
  SendAnnounceError: LogicError.extend({ name: 'SendAnnounceError', code: 40400 }),
  AnnouncementNotExistError: LogicError.extend({ name: 'AnnouncementNotExistError', code: 40404 }),

  // contract
  CreationDataError: LogicError.extend({ name: 'CreationDataError', code: 50403 }),
  ContractNameError: LogicError.extend({ name: 'ContractNameError', code: 50404 }),
  CompilerError: LogicError.extend({ name: 'CompilerError', code: 50600 }),
  ContractDecompileError: LogicError.extend({ name: 'ContractDecompileError', code: 50601 }),
  ExtractMetadataError: LogicError.extend({ name: 'ExtractMetadataError', code: 50602 }),
};
