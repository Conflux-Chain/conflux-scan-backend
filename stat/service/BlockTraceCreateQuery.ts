// @ts-ignore
import {format} from "js-conflux-sdk";
import {Hex40Map, Hex64Map} from "../model/HexMap";
import {TraceCreateContract} from "../model/TraceCreateContract";

export class BlockTraceCreateQuery{
    async getCreateTrace(contractAddr: string) {
        const simpleAddr: string = format.hexAddress(contractAddr);
        const contractAddrHex: Hex40Map = await Hex40Map.findOne({where: {hex: simpleAddr.substr(2)}});
        if(contractAddrHex === null){
            console.error(`getTraceCreate no contract ${contractAddr}`);
            return {msg: `get create trace, no contract ${contractAddr} found`};
        }

        const traceCreate:TraceCreateContract = await TraceCreateContract.findOne({where: {to: contractAddrHex.id}});
        if(traceCreate === null){
            console.error(`getTraceCreate no trace_create_contract for contract ${contractAddr}`);
            return {msg: `get create trace, no create trace found for contract ${contractAddr}`};
        }

        const txHashHex: Hex64Map = await Hex64Map.findOne({where: {id: traceCreate.txHashId}});
        const creatorHex: Hex40Map = await Hex40Map.findOne({where: {id: traceCreate.from}});
        const creatorBase32 = creatorHex ? format.address(Buffer.from(creatorHex.hex,'hex'), 1, true) : undefined;
        const createTrace = {
            transactionHash: txHashHex ? txHashHex.hex : undefined,
            creator: creatorBase32,
            contractAddr,
        };
        return createTrace;
    }
}
