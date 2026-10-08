import {keccak256} from "ethers";

// Hash the 20 address bytes, not their hex string representation.
export function mappedEspaceHex(coreHex: string): string {
    return keccak256(`0x${coreHex}`).slice(-40);
}
