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
    // 验证是否是 UserOperationEvent
    if (log.topics && log.topics[0] !== USER_OPERATION_EVENT_SIGNATURE) {
        console.log(`topics 0 mismatch ${(log.topics||[])[0]} vs ${USER_OPERATION_EVENT_SIGNATURE}`)
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
