import {ethers} from 'ethers';
import {formatBlockNumber, formatCallParams, sendRpc} from "../common/utils";
import type {CallParams, TracerOptions} from "../../../scan-api/service/ConfluxService";

export class DebugTraceClient {
    private provider: ethers.JsonRpcProvider;

    constructor(provider: ethers.JsonRpcProvider) {
        this.provider = provider
    }

    async traceWithCallTracer(
        callParams: CallParams,
        blockTag: ethers.BlockTag = 'latest',
        config?: {
            withLog?: boolean;
            onlyTopCall?: boolean;
            withReturnData?: boolean;
        }
    ): Promise<any> {
        return this.trace(callParams,
            blockTag,
            {
                tracer: 'callTracer',
                tracerConfig: {
                    withLog: config?.withLog ?? true,
                    onlyTopCall: config?.onlyTopCall ?? false,
                    withReturnData: config?.withReturnData ?? false,
                },
            },
        );
    }

    async traceWithPrestateTracer(
        callParams: CallParams,
        blockTag: ethers.BlockTag = 'latest',
        config?: {
            diffMode?: boolean;
        }
    ): Promise<any> {
        return this.trace(callParams,
            blockTag,
            {
                tracer: 'prestateTracer',
                tracerConfig: {
                    diffMode: config?.diffMode ?? false,
                },
            },
        );
    }

    async traceWithStructLogs(
        callParams: CallParams,
        blockTag: ethers.BlockTag = 'latest',
        config?: {
            disableMemory?: boolean;
            disableStack?: boolean;
            disableStorage?: boolean;
            enableReturnData?: boolean;
            limit?: number;
        }
    ): Promise<any> {
        return this.trace(callParams,
            blockTag,
            {
                tracer: 'structLogs',
                tracerConfig: {
                    disableMemory: config?.disableMemory ?? false,
                    disableStack: config?.disableStack ?? false,
                    disableStorage: config?.disableStorage ?? true,
                    enableReturnData: config?.enableReturnData ?? true,
                    limit: config?.limit,
                },
            },
        );
    }

    async trace(
        callParams: CallParams,
        blockNumber: ethers.BlockTag,
        tracerOptions: TracerOptions
    ): Promise<any> {
        blockNumber = blockNumber || 'latest';
        tracerOptions = tracerOptions || {tracer: 'callTracer'};

        const formattedCall = formatCallParams(callParams);
        const blockParam = formatBlockNumber(blockNumber);
        const rpcParams: any[] = [formattedCall, blockParam];

        if (tracerOptions.tracer) {
            rpcParams.push(tracerOptions);
        }

        return sendRpc(this.provider, "debug_traceCall", rpcParams);
    }
}

async function main() {
    const provider = new ethers.JsonRpcProvider("http://evm.confluxrpc.com");
    const client = new DebugTraceClient(provider);

    const transferCall: CallParams = { // cfx-evm mainnet
        from: "0xFFEd85fc673d5d3d0703f5176957e6A1Ac80Cc0f", //M
        // to: "0xaf37E8B6C9ED7f6318979f56Fc287d76c30847ff", //O
        // value: "0x0", //O
        // data: "0xa9059cbb00000000000000000000000062e6204948211e7f570e459232adc0e02057f0be00000000000000000000000000000000000000000000000000000000005b8d80", //O // transferFrom 7250000
        // gas: "0x11809", //O
        // type: "0x02", //O
        // nonce: "0x131", //O
        // maxPriorityFeePerGas: "0x1dcd6500", //O
        maxFeePerGas: "0x55ae82600", //M
        // accessList: [], //O
    };

    await client.traceWithCallTracer(transferCall);
}

main().then();

