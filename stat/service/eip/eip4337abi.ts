import { ethers } from 'ethers';

// Event signature for UserOperationEvent
const USER_OPERATION_EVENT_SIGNATURE = ethers.id("UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256)");

// ABI-encoded types for event parameters
const EVENT_ABI = [
    "bytes32 indexed userOpHash",
    "address indexed sender",
    "address indexed paymaster",
    "uint256 nonce",
    "bool success",
    "uint256 actualGasCost",
    "uint256 actualGasUsed"
];

export interface IUserOperationEvent {
    address: string; // the contract from which the event emit
    //
    userOpHash: string;
    sender: string;
    paymaster: string;
    nonce: bigint;
    success: boolean;
    actualGasCost: bigint;
    actualGasUsed: bigint;
}

/**
 * Parse a UserOperationEvent log entry
 * @param log - blockchain event log
 * @returns parsed UserOperationEvent object
 * @throws if log is not a UserOperationEvent or data length does not match
 */
export function parseUserOperationEvent(log: any): IUserOperationEvent {
    // Check that topics field exists and contains all indexed parameters
    if (!log.topics || log.topics.length < 4) {
        return null;
    }

    // Verify this is a UserOperationEvent
    if (log.topics[0] !== USER_OPERATION_EVENT_SIGNATURE) {
        // console.log(`topics 0 mismatch ${(log.topics||[])[0]} vs ${USER_OPERATION_EVENT_SIGNATURE}`)
        return null;
    }

    // Check that the data field exists
    if (!log.data) {
        console.log(` ${__filename} no data`);
        return null;
    }

    // The data field encodes 4 uint256 parameters (each 32 bytes = 64 hex chars):
    // nonce (uint256): 32 bytes
    // success (bool): 32 bytes (only the first byte is used)
    // actualGasCost (uint256): 32 bytes
    // actualGasUsed (uint256): 32 bytes
    // Total: 4 * 32 = 128 bytes = 256 hex characters (excluding 0x prefix)
    const dataWithoutPrefix = log.data.startsWith('0x') ? log.data.slice(2) : log.data;
    const expectedDataLength = 256; // 4 * 64 chars

    if (dataWithoutPrefix.length !== expectedDataLength) {
        console.log(`data length ${dataWithoutPrefix.length} vs ${expectedDataLength}`);
        return null;
    }

    // Parse indexed parameters from topics:
    // topics[0] = event signature
    // topics[1] = userOpHash (bytes32 indexed)
    // topics[2] = sender (address indexed)
    // topics[3] = paymaster (address indexed)
    const userOpHash = log.topics[1];
    const sender = ethers.getAddress('0x' + log.topics[2].slice(-40));
    const paymaster = ethers.getAddress('0x' + log.topics[3].slice(-40));

    // Parse non-indexed parameters from data:
    // data format: [nonce, success, actualGasCost, actualGasUsed], each 32 bytes
    const nonce = ethers.toBigInt(log.data.slice(0, 66));      // first 32 bytes (0x + 64 chars)
    const success = ethers.toBigInt('0x'+log.data.slice(66, 130)) !== 0n;  // second 32 bytes, non-zero means true
    const actualGasCost = ethers.toBigInt('0x' + log.data.slice(130, 194));   // third 32 bytes
    const actualGasUsed = ethers.toBigInt('0x'+log.data.slice(194, 258));   // fourth 32 bytes

    return {
        address: log.address,
        userOpHash,
        sender,
        paymaster,
        nonce,
        success,
        actualGasCost,
        actualGasUsed
    } as IUserOperationEvent;
}

// ------

// Event signature for AccountDeployed
const ACCOUNT_DEPLOYED_EVENT_SIGNATURE = ethers.id("AccountDeployed(bytes32,address,address,address)");

// Event interface
const reasonInterface = new ethers.Interface([
    "event AccountDeployed(bytes32 indexed userOpHash, address indexed sender, address factory, address paymaster)"
]);

export interface IAccountDeployedEvent {
    address: string; // the contract from which the event emit
    userOpHash: string;
    sender: string;
    factory: string;
    paymaster: string;
}

/**
 * Parse an AccountDeployed event using ethers Interface
 * @param log - blockchain event log
 * @returns parsed AccountDeployed object
 * @throws if parsing fails or data length does not match
 */
export function parseAccountDeployed(log: any): IAccountDeployedEvent {
    try {
        // Verify this is an AccountDeployed event
        if (!log.topics || log.topics.length < 3) {
            // throw new Error("Invalid log topics: expected at least 3 topics");
            return null;
        }

        if (log.topics[0] !== ACCOUNT_DEPLOYED_EVENT_SIGNATURE) {
            // throw new Error(`Invalid event signature: expected AccountDeployed, got ${log.topics[0]}`);
            return null;
        }

        // Check that the data field exists
        if (!log.data || log.data === '0x') {
            // throw new Error("Log data is missing or empty");
            return null;
        }

        // Validate data length:
        // data contains two address parameters: factory (address) and paymaster (address)
        // each address occupies 32 bytes in ABI encoding (64 hex chars, excluding 0x prefix)
        // Total: 2 * 32 = 64 bytes = 128 hex characters
        const dataWithoutPrefix = log.data.startsWith('0x') ? log.data.slice(2) : log.data;
        const expectedDataLength = 128; // 2 * 64 chars

        if (dataWithoutPrefix.length !== expectedDataLength) {
            // throw new Error(
            //     `Invalid data length: expected ${expectedDataLength} hex chars (64 bytes), ` +
            //     `got ${dataWithoutPrefix.length} hex chars`
            // );
            return null;
        }

        // Parse using Interface
        const parsedLog = reasonInterface.parseLog(log);

        if (!parsedLog) {
            // throw new Error("Failed to parse log as AccountDeployed");
            return null;
        }

        const args = parsedLog.args as any;

        return {
            address: log.address,
            userOpHash: args.userOpHash,
            sender: args.sender,
            factory: args.factory,
            paymaster: args.paymaster
        } as IAccountDeployedEvent;
    } catch (error: any) {
        // throw new Error(`Failed to parse AccountDeployed: ${error.message}`);
        console.error(__filename, ' ', error);
        return null;
    }
}

/**
 * Manually parse an AccountDeployed event (without relying on ethers Interface)
 * @param log - blockchain event log
 * @returns parsed AccountDeployed object
 * @throws if data length does not match
 */
export function parseAccountDeployedManual(log: any): IAccountDeployedEvent {
    // Validate event signature
    if (log.topics && log.topics[0] !== ACCOUNT_DEPLOYED_EVENT_SIGNATURE) {
        throw new Error(`Invalid event signature: expected AccountDeployed, got ${log.topics?.[0]}`);
    }

    // Check the data field
    if (!log.data || log.data === '0x') {
        throw new Error("Log data is missing or empty");
    }

    // Validate data length
    const dataWithoutPrefix = log.data.startsWith('0x') ? log.data.slice(2) : log.data;
    const expectedDataLength = 128; // 2 addresses, 32 bytes each

    if (dataWithoutPrefix.length !== expectedDataLength) {
        throw new Error(
            `Invalid data length: expected ${expectedDataLength} hex chars (64 bytes), ` +
            `got ${dataWithoutPrefix.length} hex chars`
        );
    }

    // Parse indexed parameters from topics:
    // topics[0] = event signature
    // topics[1] = userOpHash (bytes32 indexed)
    // topics[2] = sender (address indexed)
    const userOpHash = log.topics[1];
    const sender = ethers.getAddress(log.topics[2]);

    // Parse non-indexed parameters from data:
    // data format: [factory, paymaster], each 32 bytes
    // factory: first 32 bytes, last 20 bytes used as address
    // paymaster: second 32 bytes, last 20 bytes used as address
    const factoryBytes = log.data.slice(0, 66);  // 0x + 64 chars
    const paymasterBytes = log.data.slice(66, 130); // next 64 chars

    // Convert bytes32 to address (take last 20 bytes)
    const factory = ethers.getAddress('0x' + factoryBytes.slice(-40));
    const paymaster = ethers.getAddress('0x' + paymasterBytes.slice(-40));

    return {
        address: log.address,
        userOpHash,
        sender,
        factory,
        paymaster
    };
}

// ------

// Event signature for UserOperationRevertReason
const USER_OP_REVERT_REASON_EVENT_SIGNATURE = ethers.id("UserOperationRevertReason(bytes32,address,uint256,bytes)");

// Event interface
const eventInterface = new ethers.Interface([
    "event UserOperationRevertReason(bytes32 indexed userOpHash, address indexed sender, uint256 nonce, bytes revertReason)"
]);

export interface IUserOperationRevertReason {
    address: string; // the contract from which the event emit
    userOpHash: string;
    sender: string;
    nonce: bigint;
    revertReason: string;
}

/**
 * Parse a UserOperationRevertReason event using ethers Interface
 * @param log - blockchain event log
 * @returns parsed UserOperationRevertReason object
 * @throws if parsing fails or data length does not match
 */
export function parseUserOperationRevertReason(log: any): IUserOperationRevertReason {
    try {
        // Verify this is a UserOperationRevertReason event
        if (!log.topics || log.topics.length < 3) {
            // throw new Error("Invalid log topics: expected at least 3 topics");
            return null;
        }

        if (log.topics[0] !== USER_OP_REVERT_REASON_EVENT_SIGNATURE) {
            // throw new Error(`Invalid event signature: expected UserOperationRevertReason, got ${log.topics[0]}`);
            return null;
        }

        // Check that the data field exists
        if (!log.data || log.data === '0x') {
            // throw new Error("Log data is missing or empty");
            return null;
        }

        // Validate minimum data length:
        // data contains: nonce (uint256, 32 bytes) + revertReason (bytes, dynamic length)
        // at minimum 32 bytes for nonce, plus the bytes length prefix
        const dataWithoutPrefix = log.data.startsWith('0x') ? log.data.slice(2) : log.data;
        const minDataLength = 64; // at least 32 bytes (nonce) in hex chars

        if (dataWithoutPrefix.length < minDataLength) {
            // throw new Error(
            //     `Invalid data length: expected at least ${minDataLength} hex chars (32 bytes), ` +
            //     `got ${dataWithoutPrefix.length} hex chars`
            // );
            return null;
        }

        // Parse using Interface
        const parsedLog = eventInterface.parseLog(log);

        if (!parsedLog) {
            // throw new Error("Failed to parse log as UserOperationRevertReason");
            return null;
        }

        const args = parsedLog.args as any;

        // Decode ABI-encoded revert data to expose standard Error(string) messages
        const revertReasonStr = parseRevertReason(args.revertReason);

        return {
            address: log.address,
            userOpHash: args.userOpHash,
            sender: args.sender,
            nonce: args.nonce,
            revertReason: revertReasonStr
        };
    } catch (error: any) {
        // throw new Error(`Failed to parse UserOperationRevertReason: ${error.message}`);
        console.error(__filename, ' ', error);
        return null;
    }
}

/**
 * Manually parse a UserOperationRevertReason event (without relying on ethers Interface)
 * @param log - blockchain event log
 * @returns parsed UserOperationRevertReason object
 * @throws if data length does not match
 */
export function parseUserOperationRevertReasonManual(log: any): IUserOperationRevertReason {
    // Validate event signature
    if (log.topics && log.topics[0] !== USER_OP_REVERT_REASON_EVENT_SIGNATURE) {
        throw new Error(`Invalid event signature: expected UserOperationRevertReason, got ${log.topics?.[0]}`);
    }

    // Check the data field
    if (!log.data || log.data === '0x') {
        throw new Error("Log data is missing or empty");
    }

    // Validate minimum data length
    const dataWithoutPrefix = log.data.startsWith('0x') ? log.data.slice(2) : log.data;
    const minDataLength = 64; // at least 32 bytes (nonce)

    if (dataWithoutPrefix.length < minDataLength) {
        throw new Error(
            `Invalid data length: expected at least ${minDataLength} hex chars (32 bytes), ` +
            `got ${dataWithoutPrefix.length} hex chars`
        );
    }

    // Parse indexed parameters from topics:
    // topics[0] = event signature
    // topics[1] = userOpHash (bytes32 indexed)
    // topics[2] = sender (address indexed)
    const userOpHash = log.topics[1];
    const sender = ethers.getAddress(log.topics[2]);

    // Parse non-indexed parameters from data:
    // data format: [nonce (uint256), revertReason (bytes)]
    // nonce: first 32 bytes
    // revertReason: remainder, needs bytes decoding

    // Parse nonce (first 32 bytes)
    const nonceHex = log.data.slice(0, 66); // 0x + 64 chars
    const nonce = ethers.toBigInt(nonceHex);

    // Parse revertReason (bytes type)
    // bytes encoding format: [length (uint256)] + [data]
    const remainingData = '0x' + dataWithoutPrefix.slice(64);
    const revertReasonBytes = ethers.getBytes(remainingData);

    // The first 32 bytes of bytes are the length
    if (revertReasonBytes.length < 32) {
        throw new Error("Invalid revertReason encoding: missing length prefix");
    }

    const dataLength = Number(ethers.toBigInt(revertReasonBytes.slice(0, 32)));
    const actualData = revertReasonBytes.slice(32, 32 + dataLength);

    // Attempt to convert to string
    let revertReasonStr: string;
    try {
        revertReasonStr = ethers.toUtf8String(actualData);
    } catch {
        revertReasonStr = ethers.hexlify(actualData);
    }

    return {
        address: log.address,
        userOpHash,
        sender,
        nonce,
        revertReason: revertReasonStr
    };
}

/**
 * Parse a revert reason into a human-readable string (helper function)
 * @param revertReasonBytes - bytes data of the revert reason
 * @returns human-readable string
 */
export function parseRevertReason(revertReasonBytes: string): string {
    if (!revertReasonBytes || revertReasonBytes === '0x') {
        return '';
    }

    try {
        // Attempt to parse as UTF-8 string
        return ethers.toUtf8String(revertReasonBytes);
    } catch {
        // Attempt to parse as a custom error
        try {
            // Check if this is a standard Error(string) signature
            if (revertReasonBytes.startsWith('0x08c379a0')) {
                // This is the Error(string) signature
                const iface = new ethers.Interface([
                    "function Error(string)"
                ]);
                const decoded = iface.decodeErrorResult("Error", revertReasonBytes);
                return decoded[0];
            }
        } catch {
            // If unable to parse, return hex
            return revertReasonBytes;
        }
    }

    return revertReasonBytes;
}
