// @ts-ignore
import {Hex40Map, Hex64Map} from "../model/HexMap";
import {TraceCreateContract} from "../model/TraceCreateContract";

export class BlockTraceCreateQuery{
    async getCreateTrace(contractAddr: string) {
        const contractAddrHex = await Hex40Map.findOne({where: {hex: contractAddr.substr(2)}});
        if(!contractAddrHex){
            console.error(`getTraceCreate no contract ${contractAddr}`);
            return {msg: `get create trace, no contract ${contractAddr} found`};
        }

        const traceCreate = await TraceCreateContract.findOne({where: {to: contractAddrHex.id}});
        if(!traceCreate){
            console.error(`getTraceCreate no trace_create_contract for contract ${contractAddr}`);
            return {msg: `get create trace, no create trace found for contract ${contractAddr}`};
        }

        const txHashHex = await Hex64Map.findOne({where: {id: traceCreate.txHashId}});
        const creatorHex = await Hex40Map.findOne({where: {id: traceCreate.from}});
        return {
            transactionHash: txHashHex ? '0x' + txHashHex.hex : undefined,
            creator: creatorHex ? '0x' + creatorHex.hex : undefined,
            contractAddr,
        };
    }
}
