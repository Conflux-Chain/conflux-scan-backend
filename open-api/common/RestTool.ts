import {CODE_PARAMETER_ABSENT_MSG} from "./Def";
import {StatApp} from "../../stat/StatApp";
import {format} from "js-conflux-sdk";

export class KnownError extends Error{}

export function checkAddress(ctx, base32) {
    if (!Boolean(base32)) {
        throw new KnownError(CODE_PARAMETER_ABSENT_MSG)
    }
}

export function formatAddr(addr) {
    return StatApp.isEVM ? format.hexAddress(addr) : format.address(addr, StatApp.networkId);
}