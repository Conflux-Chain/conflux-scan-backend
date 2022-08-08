const LogicError = require('koaflow/lib/util/LogicError').extend({ status: 600 });

module.exports = {

  LogicError,
  BizError: LogicError.extend({ code: 50100, name: 'BizError' }),
  ParameterError: LogicError.extend({ code: 50101, name: 'ParameterError' }),
  PermissionsError: LogicError.extend({ code: 50102, name: 'PermissionsError' }),
  ApiBusyError: LogicError.extend({ code: 50103, name: 'ApiBusyError' }),

  ResponseDataParsingError: LogicError.extend({ code: 50202, name: 'ResponseDataParsingError'}),

  SendAnnounceError: LogicError.extend({ code: 50301,  name: 'SendAnnounceError' }),
  AnnouncementNotExistError: LogicError.extend({ code: 50302, name: 'AnnouncementNotExistError' }),
  AnnounceTooLongError: LogicError.extend({ code: 50303, name: 'AnnounceTooLongError' }),

  QueryCreationDataError: LogicError.extend({ code: 50401, name: 'QueryCreationDataError' }),

  CompilerError: LogicError.extend({ code: 50701, name: 'CompilerError' }),
  ContractDecompileError: LogicError.extend({ code: 50702, name: 'ContractDecompileError' }),
  ExtractMetadataError: LogicError.extend({ code: 50703, name: 'ExtractMetadataError' }),
  ContractNameError: LogicError.extend({ code: 50704, name: 'ContractNameError' }),
};
