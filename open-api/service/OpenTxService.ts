import {format} from "js-conflux-sdk";
import {Hex40Map} from "../../stat/model/HexMap";
import {AddressTransactionIndex} from "../../stat/model/FullBlock";

export async function base32id(base32: string) {
    const hex = format.hexAddress(base32)
    return Hex40Map.findOne({where: {hex: hex.substr(2)} });
}
export async function queryAccountTx({base32,startEpoch,endEpoch,startTimestamp,endTimestamp,sort
                                     }) {
    const ownerId = await base32id(base32);
    const page = await AddressTransactionIndex.findAndCountAll({
        where: {addressId: ownerId}
    })
}