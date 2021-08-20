import {CODE_ACCOUNT_ADDRESS_ABSENT_MSG} from "./Def";

export class KnownError extends Error{}
export function checkAddress(ctx, base32) {
    if (!Boolean(base32)) {
        throw new KnownError(CODE_ACCOUNT_ADDRESS_ABSENT_MSG)
    }
}