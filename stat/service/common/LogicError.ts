class LogicError extends Error {
    public code: number;
    public status: number;

    public constructor(msg) {
        super();
        this.message = msg;
    }

    public static extend({ name, code, status = 600 }) {
        class BizError extends this {
            public partialData: any;
            constructor(msg) {
                super(msg);
                Object.assign(this, { name, code, status });
            }
        }
        return BizError;
    }
}

export const Errors = {
    // common error
    BizError: LogicError.extend({ code: 50100, name: 'BizError' }),
    ParameterError: LogicError.extend({ code: 50101, name: 'ParameterError' }),
    PermissionError: LogicError.extend({ code: 50102, name: 'PermissionError' }),
    ApiBusyError: LogicError.extend({ code: 50103, name: 'ApiBusyError' }),

    // network error
    NetworkError: LogicError.extend({ code: 50200, name: 'NetworkError'}),
    RequestTimeout: LogicError.extend({ code: 50201, name: 'RequestTimeout'}),
    ResponseDataParsingError: LogicError.extend({ code: 50202, name: 'ResponseDataParsingError'}),

    // RPC error
    RPCCallError: LogicError.extend({ code: 50300, name: 'RPCCallError'}),
    SendAnnounceError: LogicError.extend({ code: 50301, name: 'SendAnnounceError' }),
    AnnouncementNotExistError: LogicError.extend({ code: 50302, name: 'AnnouncementNotExistError' }),
    AnnounceTooLongError: LogicError.extend({ code: 50303, name: 'AnnounceTooLongError' }),

    // contract error
    QueryContractError: LogicError.extend({ code: 50400, name: 'QueryContractError' }),
    QueryCreationDataError: LogicError.extend({ code: 50401, name: 'QueryCreationDataError' }),

    // token error
    QueryTokenError: LogicError.extend({ code: 50500, name: 'QueryTokenError' }),
    NotTokenError: LogicError.extend({ code: 50501, name: 'NotTokenError'}),

    // NFT error
    QueryNFTError: LogicError.extend({ code: 50600, name: 'QueryNFTError' }),
    CallNFTContractError: LogicError.extend({ code: 50301, name: 'CallNFTContractError' }),
    QueryNFTMetadataError: LogicError.extend({ code: 50302, name: 'QueryNFTMetadataError' }),
    ParseNFTMetadataError: LogicError.extend({ code: 50303, name: 'ParseNFTMetadataError' }),
    QueryNFTLocalNameError: LogicError.extend({ code: 50604, name: 'QueryNFTLocalNameError' }),
    MetadataPropertyError: LogicError.extend({ code: 50605, name: 'MetadataPropertyError'}),

    // verify error
    ContractVerifyError: LogicError.extend({ code: 50700, name: 'ContractVerifyError' }),
    CompilerError: LogicError.extend({ code: 50701, name: 'CompilerError' }),
    ContractDecompileError: LogicError.extend({ code: 50702, name: 'ContractDecompileError' }),
    ExtractMetadataError: LogicError.extend({ code: 50703, name: 'ExtractMetadataError' }),
    ContractNotFoundError: LogicError.extend({ code: 50704, name: 'ContractNotFoundError' }),
}
