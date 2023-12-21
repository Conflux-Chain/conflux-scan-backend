class LogicError extends Error {
    public code: number;
    public status: number;

    public constructor(msg) {
        super();
        this.message = msg;
    }

    public static extend({ name, code, status = 600 }): any {
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
export const UnhandledErrorCode = 50001;
export const Errors = {
    // common error
    UnhandledError: LogicError.extend({ code: UnhandledErrorCode, name: 'Unhandled error' }),
    BizError: LogicError.extend({ code: 50100, name: 'Unknown error, please try again later, or submit a ticket' }),
    ParameterError: LogicError.extend({ code: 50101, name: 'The parameter is wrong, please confirm it is correct' }),
    PermissionError: LogicError.extend({ code: 50102, name: 'Permission Error' }),
    ApiBusyError: LogicError.extend({ code: 50103, name: 'The system is too busy now, please try again later' }),
    RpcBusyError: LogicError.extend({ code: 50104, name: 'The underlying service(full-node) is too busy now. CODE[RPC]' }),
    RpcBizError: LogicError.extend({ code: 50105, name: 'The underlying service(full-node) returns an error. CODE[RPC-E]' }),

    // network error
    NetworkError: LogicError.extend({ code: 50200, name: 'Network exception, try again later'}),
    RequestTimeout: LogicError.extend({ code: 50201, name: 'External data request timeout, try again later'}),
    ResponseDataParsingError: LogicError.extend({ code: 50202, name: 'Data parsing exception, try again later'}),

    // RPC error
    RPCCallError: LogicError.extend({ code: 50300, name: 'RPC Call Error, try again later, or submit a ticket'}),
    SendAnnounceError: LogicError.extend({ code: 50301, name: 'Send Announce Error' }),
    AnnouncementNotExistError: LogicError.extend({ code: 50302, name: 'Announcement Not Exist Error' }),
    AnnounceTooLongError: LogicError.extend({ code: 50303, name: 'Announce Too Long Error' }),

    // contract error
    QueryContractError: LogicError.extend({ code: 50400, name: 'Query Contract Error, try again later, or submit a ticket' }),
    QueryCreationDataError: LogicError.extend({ code: 50401, name: 'Query Contract Error, data is not synced, try again later' }),

    // token error
    QueryTokenError: LogicError.extend({ code: 50500, name: 'Query Token Error, try again later, or submit a ticket' }),
    NotTokenError: LogicError.extend({ code: 50501, name: 'Contract Error, does not meet the token standard'}),

    // NFT error
    QueryNFTError: LogicError.extend({ code: 50600, name: 'Query NFT Error, try again later, or submit a ticket' }),
    CallNFTContractError: LogicError.extend({ code: 50601, name: 'Contract Error, failed to get TokenURI from contract' }),
    QueryNFTMetadataError: LogicError.extend({ code: 50602, name: 'Metadata Error, unable to request the TokenURI returned by the contract' }),
    ParseNFTMetadataError: LogicError.extend({ code: 50603, name: 'Metadata Error, the metadata for this NFT could not be parsed' }),
    QueryNFTLocalNameError: LogicError.extend({ code: 50604, name: 'Contract Error, Could not get the Local Name for this NFT' }),
    MetadataPropertyError: LogicError.extend({ code: 50605, name: 'Metadata Error, the Metadata for this NFT is malformed'}),

    // verify error
    ContractVerifyError: LogicError.extend({ code: 50700, name: 'Contract Verify Error, try again later, or submit a ticket' }),
    CompilerError: LogicError.extend({ code: 50701, name: 'Contract Verify Error, error compiling Source Code' }),
    ContractDecompileError: LogicError.extend({ code: 50702, name: 'Contract Verify Error, failed to decompile the contract' }),
    ExtractMetadataError: LogicError.extend({ code: 50703, name: 'Contract Verify Error, failed to get metadata in Bytecode' }),
    ContractNameError: LogicError.extend({ code: 50704, name: 'Contract Verify Error, the contract could not be found or the contract name was entered incorrectly' }),
}
