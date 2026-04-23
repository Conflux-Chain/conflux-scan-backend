import { ethers } from 'ethers';

// UserOperationEvent 的事件签名
const USER_OPERATION_EVENT_SIGNATURE = ethers.id("UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256)");

// 事件参数的 ABI 编码类型
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
 * 解析 UserOperationEvent 事件
 * @param log - 区块链事件日志
 * @returns 解析后的 UserOperationEvent 对象
 * @throws 如果 log 不是 UserOperationEvent 或 data 长度不匹配
 */
export function parseUserOperationEvent(log: any): IUserOperationEvent {
    // 检查 topics 字段是否存在且包含完整的 indexed 参数
    if (!log.topics || log.topics.length < 4) {
        return null;
    }

    // 验证是否是 UserOperationEvent
    if (log.topics[0] !== USER_OPERATION_EVENT_SIGNATURE) {
        // console.log(`topics 0 mismatch ${(log.topics||[])[0]} vs ${USER_OPERATION_EVENT_SIGNATURE}`)
        return null;
    }

    // 检查 data 字段是否存在
    if (!log.data) {
        console.log(` ${__filename} no data`);
        return null;
    }

    // data 字段应该是 4 个 uint256 参数的编码 (每个 32 字节 = 64 字符)
    // nonce (uint256): 32 字节
    // success (bool): 32 字节 (实际只使用第一个字节)
    // actualGasCost (uint256): 32 字节
    // actualGasUsed (uint256): 32 字节
    // 总共: 4 * 32 = 128 字节 = 256 个十六进制字符 (不含 0x 前缀)
    const dataWithoutPrefix = log.data.startsWith('0x') ? log.data.slice(2) : log.data;
    const expectedDataLength = 256; // 4 * 64 字符

    if (dataWithoutPrefix.length !== expectedDataLength) {
        console.log(`data length ${dataWithoutPrefix.length} vs ${expectedDataLength}`);
        return null;
    }

    // 解析 topics 中的 indexed 参数
    // topics[0] = event signature
    // topics[1] = userOpHash (bytes32 indexed)
    // topics[2] = sender (address indexed)
    // topics[3] = paymaster (address indexed)
    const userOpHash = log.topics[1];
    const sender = ethers.getAddress('0x' + log.topics[2].slice(-40));
    const paymaster = ethers.getAddress('0x' + log.topics[3].slice(-40));

    // 解析 data 中的非 indexed 参数
    // data 格式: [nonce, success, actualGasCost, actualGasUsed] 每个都是 32 字节
    const nonce = ethers.toBigInt(log.data.slice(0, 66));      // 第一个 32 字节 (0x + 64 chars)
    const success = ethers.toBigInt('0x'+log.data.slice(66, 130)) !== 0n;  // 第二个 32 字节，非零即为 true
    const actualGasCost = ethers.toBigInt('0x' + log.data.slice(130, 194));   // 第三个 32 字节
    const actualGasUsed = ethers.toBigInt('0x'+log.data.slice(194, 258));   // 第四个 32 字节

    return {
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

// AccountDeployed 的事件签名
const ACCOUNT_DEPLOYED_EVENT_SIGNATURE = ethers.id("AccountDeployed(bytes32,address,address,address)");

// 事件接口
const reasonInterface = new ethers.Interface([
    "event AccountDeployed(bytes32 indexed userOpHash, address indexed sender, address factory, address paymaster)"
]);

export interface IAccountDeployedEvent {
    userOpHash: string;
    sender: string;
    factory: string;
    paymaster: string;
}

export class AccountDeployedEvent implements IAccountDeployedEvent {
    userOpHash: string;
    sender: string;
    factory: string;
    paymaster: string;

    constructor(data: IAccountDeployedEvent) {
        this.userOpHash = data.userOpHash;
        this.sender = data.sender;
        this.factory = data.factory;
        this.paymaster = data.paymaster;
    }
}

/**
 * 使用 ethers Interface 解析 AccountDeployed 事件
 * @param log - 区块链事件日志
 * @returns 解析后的 AccountDeployed 对象
 * @throws 如果解析失败或 data 长度不匹配
 */
export function parseAccountDeployed(log: any): AccountDeployedEvent {
    try {
        // 验证是否是 AccountDeployed 事件
        if (!log.topics || log.topics.length < 3) {
            // throw new Error("Invalid log topics: expected at least 3 topics");
            return null;
        }

        if (log.topics[0] !== ACCOUNT_DEPLOYED_EVENT_SIGNATURE) {
            // throw new Error(`Invalid event signature: expected AccountDeployed, got ${log.topics[0]}`);
            return null;
        }

        // 检查 data 字段是否存在
        if (!log.data || log.data === '0x') {
            // throw new Error("Log data is missing or empty");
            return null;
        }

        // 验证 data 长度
        // data 包含两个 address 参数: factory (address) 和 paymaster (address)
        // 每个 address 在 abi 编码中占 32 字节 (64 个十六进制字符，不含 0x 前缀)
        // 总共: 2 * 32 = 64 字节 = 128 个十六进制字符
        const dataWithoutPrefix = log.data.startsWith('0x') ? log.data.slice(2) : log.data;
        const expectedDataLength = 128; // 2 * 64 字符

        if (dataWithoutPrefix.length !== expectedDataLength) {
            // throw new Error(
            //     `Invalid data length: expected ${expectedDataLength} hex chars (64 bytes), ` +
            //     `got ${dataWithoutPrefix.length} hex chars`
            // );
            return null;
        }

        // 使用 Interface 解析
        const parsedLog = reasonInterface.parseLog(log);

        if (!parsedLog) {
            // throw new Error("Failed to parse log as AccountDeployed");
            return null;
        }

        const args = parsedLog.args as any;

        return new AccountDeployedEvent({
            userOpHash: args.userOpHash,
            sender: args.sender,
            factory: args.factory,
            paymaster: args.paymaster
        });
    } catch (error: any) {
        // throw new Error(`Failed to parse AccountDeployed: ${error.message}`);
        console.error(__filename, ' ', error);
        return null;
    }
}

/**
 * 手动解析 AccountDeployed 事件（不依赖 ethers Interface）
 * @param log - 区块链事件日志
 * @returns 解析后的 AccountDeployed 对象
 * @throws 如果 data 长度不匹配
 */
export function parseAccountDeployedManual(log: any): AccountDeployedEvent {
    // 验证事件签名
    if (log.topics && log.topics[0] !== ACCOUNT_DEPLOYED_EVENT_SIGNATURE) {
        throw new Error(`Invalid event signature: expected AccountDeployed, got ${log.topics?.[0]}`);
    }

    // 检查 data 字段
    if (!log.data || log.data === '0x') {
        throw new Error("Log data is missing or empty");
    }

    // 验证 data 长度
    const dataWithoutPrefix = log.data.startsWith('0x') ? log.data.slice(2) : log.data;
    const expectedDataLength = 128; // 2个 address，每个 32 字节

    if (dataWithoutPrefix.length !== expectedDataLength) {
        throw new Error(
            `Invalid data length: expected ${expectedDataLength} hex chars (64 bytes), ` +
            `got ${dataWithoutPrefix.length} hex chars`
        );
    }

    // 解析 topics 中的 indexed 参数
    // topics[0] = event signature
    // topics[1] = userOpHash (bytes32 indexed)
    // topics[2] = sender (address indexed)
    const userOpHash = log.topics[1];
    const sender = ethers.getAddress(log.topics[2]);

    // 解析 data 中的非 indexed 参数
    // data 格式: [factory, paymaster] 每个都是 32 字节
    // factory: 第一个 32 字节，取后 20 字节作为地址
    // paymaster: 第二个 32 字节，取后 20 字节作为地址
    const factoryBytes = log.data.slice(0, 66);  // 0x + 64 chars
    const paymasterBytes = log.data.slice(66, 130); // 下一个 64 chars

    // 将 bytes32 转换为 address（取后20字节）
    const factory = ethers.getAddress('0x' + factoryBytes.slice(-40));
    const paymaster = ethers.getAddress('0x' + paymasterBytes.slice(-40));

    return new AccountDeployedEvent({
        userOpHash,
        sender,
        factory,
        paymaster
    });
}

// ------

// UserOperationRevertReason 的事件签名
const USER_OP_REVERT_REASON_EVENT_SIGNATURE = ethers.id("UserOperationRevertReason(bytes32,address,uint256,bytes)");

// 事件接口
const eventInterface = new ethers.Interface([
    "event UserOperationRevertReason(bytes32 indexed userOpHash, address indexed sender, uint256 nonce, bytes revertReason)"
]);

export interface IUserOperationRevertReason {
    userOpHash: string;
    sender: string;
    nonce: bigint;
    revertReason: string;
}

export class UserOperationRevertReason implements IUserOperationRevertReason {
    userOpHash: string;
    sender: string;
    nonce: bigint;
    revertReason: string;

    constructor(data: IUserOperationRevertReason) {
        this.userOpHash = data.userOpHash;
        this.sender = data.sender;
        this.nonce = data.nonce;
        this.revertReason = data.revertReason;
    }
}

/**
 * 使用 ethers Interface 解析 UserOperationRevertReason 事件
 * @param log - 区块链事件日志
 * @returns 解析后的 UserOperationRevertReason 对象
 * @throws 如果解析失败或 data 长度不匹配
 */
export function parseUserOperationRevertReason(log: any): UserOperationRevertReason {
    try {
        // 验证是否是 UserOperationRevertReason 事件
        if (!log.topics || log.topics.length < 3) {
            // throw new Error("Invalid log topics: expected at least 3 topics");
            return null;
        }

        if (log.topics[0] !== USER_OP_REVERT_REASON_EVENT_SIGNATURE) {
            // throw new Error(`Invalid event signature: expected UserOperationRevertReason, got ${log.topics[0]}`);
            return null;
        }

        // 检查 data 字段是否存在
        if (!log.data || log.data === '0x') {
            // throw new Error("Log data is missing or empty");
            return null;
        }

        // 验证 data 最小长度
        // data 包含: nonce (uint256, 32字节) + revertReason (bytes, 动态长度)
        // 至少需要 32 字节的 nonce，加上 bytes 的长度前缀
        const dataWithoutPrefix = log.data.startsWith('0x') ? log.data.slice(2) : log.data;
        const minDataLength = 64; // 至少 32 字节 (nonce) 的十六进制字符数

        if (dataWithoutPrefix.length < minDataLength) {
            // throw new Error(
            //     `Invalid data length: expected at least ${minDataLength} hex chars (32 bytes), ` +
            //     `got ${dataWithoutPrefix.length} hex chars`
            // );
            return null;
        }

        // 使用 Interface 解析
        const parsedLog = eventInterface.parseLog(log);

        if (!parsedLog) {
            // throw new Error("Failed to parse log as UserOperationRevertReason");
            return null;
        }

        const args = parsedLog.args as any;

        // 将 revertReason 从 bytes 转换为字符串（如果是可读的字符串）
        let revertReasonStr: string;
        try {
            revertReasonStr = ethers.toUtf8String(args.revertReason);
        } catch {
            // 如果不是 UTF-8 字符串，保留十六进制表示
            revertReasonStr = args.revertReason;
        }

        return new UserOperationRevertReason({
            userOpHash: args.userOpHash,
            sender: args.sender,
            nonce: args.nonce,
            revertReason: revertReasonStr
        });
    } catch (error: any) {
        // throw new Error(`Failed to parse UserOperationRevertReason: ${error.message}`);
        console.error(__filename, ' ', error);
        return null;
    }
}

/**
 * 手动解析 UserOperationRevertReason 事件（不依赖 ethers Interface）
 * @param log - 区块链事件日志
 * @returns 解析后的 UserOperationRevertReason 对象
 * @throws 如果 data 长度不匹配
 */
export function parseUserOperationRevertReasonManual(log: any): UserOperationRevertReason {
    // 验证事件签名
    if (log.topics && log.topics[0] !== USER_OP_REVERT_REASON_EVENT_SIGNATURE) {
        throw new Error(`Invalid event signature: expected UserOperationRevertReason, got ${log.topics?.[0]}`);
    }

    // 检查 data 字段
    if (!log.data || log.data === '0x') {
        throw new Error("Log data is missing or empty");
    }

    // 验证 data 最小长度
    const dataWithoutPrefix = log.data.startsWith('0x') ? log.data.slice(2) : log.data;
    const minDataLength = 64; // 至少 32 字节 (nonce)

    if (dataWithoutPrefix.length < minDataLength) {
        throw new Error(
            `Invalid data length: expected at least ${minDataLength} hex chars (32 bytes), ` +
            `got ${dataWithoutPrefix.length} hex chars`
        );
    }

    // 解析 topics 中的 indexed 参数
    // topics[0] = event signature
    // topics[1] = userOpHash (bytes32 indexed)
    // topics[2] = sender (address indexed)
    const userOpHash = log.topics[1];
    const sender = ethers.getAddress(log.topics[2]);

    // 解析 data 中的非 indexed 参数
    // data 格式: [nonce (uint256), revertReason (bytes)]
    // nonce: 第一个 32 字节
    // revertReason: 剩余部分，需要解析 bytes 编码

    // 解析 nonce (前 32 字节)
    const nonceHex = log.data.slice(0, 66); // 0x + 64 chars
    const nonce = ethers.toBigInt(nonceHex);

    // 解析 revertReason (bytes 类型)
    // bytes 编码格式: [长度(uint256)] + [数据]
    const remainingData = '0x' + dataWithoutPrefix.slice(64);
    const revertReasonBytes = ethers.getBytes(remainingData);

    // bytes 的前 32 字节是长度
    if (revertReasonBytes.length < 32) {
        throw new Error("Invalid revertReason encoding: missing length prefix");
    }

    const dataLength = Number(ethers.toBigInt(revertReasonBytes.slice(0, 32)));
    const actualData = revertReasonBytes.slice(32, 32 + dataLength);

    // 尝试转换为字符串
    let revertReasonStr: string;
    try {
        revertReasonStr = ethers.toUtf8String(actualData);
    } catch {
        revertReasonStr = ethers.hexlify(actualData);
    }

    return new UserOperationRevertReason({
        userOpHash,
        sender,
        nonce,
        revertReason: revertReasonStr
    });
}

/**
 * 解析 revert reason 为可读字符串（辅助函数）
 * @param revertReasonBytes - revert reason 的 bytes 数据
 * @returns 可读的字符串
 */
export function parseRevertReason(revertReasonBytes: string): string {
    if (!revertReasonBytes || revertReasonBytes === '0x') {
        return '';
    }

    try {
        // 尝试作为 UTF-8 字符串解析
        return ethers.toUtf8String(revertReasonBytes);
    } catch {
        // 尝试解析为自定义错误
        try {
            // 检查是否是标准的错误签名 (Error(string))
            if (revertReasonBytes.startsWith('0x08c379a0')) {
                // 这是 Error(string) 的签名
                const iface = new ethers.Interface([
                    "function Error(string)"
                ]);
                const decoded = iface.decodeErrorResult("Error", revertReasonBytes);
                return decoded[0];
            }
        } catch {
            // 如果无法解析，返回十六进制
            return revertReasonBytes;
        }
    }

    return revertReasonBytes;
}
