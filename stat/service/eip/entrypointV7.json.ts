export const entrypointV7Json = [{
	"name": "DelegateAndRevert",
	"type": "error",
	"inputs": [{"name": "success", "type": "bool", "internalType": "bool"}, {
		"name": "ret",
		"type": "bytes",
		"internalType": "bytes"
	}]
}, {
	"name": "FailedOp",
	"type": "error",
	"inputs": [{"name": "opIndex", "type": "uint256", "internalType": "uint256"}, {
		"name": "reason",
		"type": "string",
		"internalType": "string"
	}]
}, {
	"name": "FailedOpWithRevert",
	"type": "error",
	"inputs": [{"name": "opIndex", "type": "uint256", "internalType": "uint256"}, {
		"name": "reason",
		"type": "string",
		"internalType": "string"
	}, {"name": "inner", "type": "bytes", "internalType": "bytes"}]
}, {
	"name": "PostOpReverted",
	"type": "error",
	"inputs": [{"name": "returnData", "type": "bytes", "internalType": "bytes"}]
}, {"name": "ReentrancyGuardReentrantCall", "type": "error", "inputs": []}, {
	"name": "SenderAddressResult",
	"type": "error",
	"inputs": [{"name": "sender", "type": "address", "internalType": "address"}]
}, {
	"name": "SignatureValidationFailed",
	"type": "error",
	"inputs": [{"name": "aggregator", "type": "address", "internalType": "address"}]
}, {
	"name": "AccountDeployed",
	"type": "event",
	"inputs": [{"name": "userOpHash", "type": "bytes32", "indexed": true, "internalType": "bytes32"}, {
		"name": "sender",
		"type": "address",
		"indexed": true,
		"internalType": "address"
	}, {"name": "factory", "type": "address", "indexed": false, "internalType": "address"}, {
		"name": "paymaster",
		"type": "address",
		"indexed": false,
		"internalType": "address"
	}],
	"anonymous": false
}, {"name": "BeforeExecution", "type": "event", "inputs": [], "anonymous": false}, {
	"name": "Deposited",
	"type": "event",
	"inputs": [{
		"name": "account",
		"type": "address",
		"indexed": true,
		"internalType": "address"
	}, {"name": "totalDeposit", "type": "uint256", "indexed": false, "internalType": "uint256"}],
	"anonymous": false
}, {
	"name": "PostOpRevertReason",
	"type": "event",
	"inputs": [{"name": "userOpHash", "type": "bytes32", "indexed": true, "internalType": "bytes32"}, {
		"name": "sender",
		"type": "address",
		"indexed": true,
		"internalType": "address"
	}, {"name": "nonce", "type": "uint256", "indexed": false, "internalType": "uint256"}, {
		"name": "revertReason",
		"type": "bytes",
		"indexed": false,
		"internalType": "bytes"
	}],
	"anonymous": false
}, {
	"name": "SignatureAggregatorChanged",
	"type": "event",
	"inputs": [{"name": "aggregator", "type": "address", "indexed": true, "internalType": "address"}],
	"anonymous": false
}, {
	"name": "StakeLocked",
	"type": "event",
	"inputs": [{
		"name": "account",
		"type": "address",
		"indexed": true,
		"internalType": "address"
	}, {
		"name": "totalStaked",
		"type": "uint256",
		"indexed": false,
		"internalType": "uint256"
	}, {"name": "unstakeDelaySec", "type": "uint256", "indexed": false, "internalType": "uint256"}],
	"anonymous": false
}, {
	"name": "StakeUnlocked",
	"type": "event",
	"inputs": [{
		"name": "account",
		"type": "address",
		"indexed": true,
		"internalType": "address"
	}, {"name": "withdrawTime", "type": "uint256", "indexed": false, "internalType": "uint256"}],
	"anonymous": false
}, {
	"name": "StakeWithdrawn",
	"type": "event",
	"inputs": [{
		"name": "account",
		"type": "address",
		"indexed": true,
		"internalType": "address"
	}, {"name": "withdrawAddress", "type": "address", "indexed": false, "internalType": "address"}, {
		"name": "amount",
		"type": "uint256",
		"indexed": false,
		"internalType": "uint256"
	}],
	"anonymous": false
}, {
	"name": "UserOperationEvent",
	"type": "event",
	"inputs": [{"name": "userOpHash", "type": "bytes32", "indexed": true, "internalType": "bytes32"}, {
		"name": "sender",
		"type": "address",
		"indexed": true,
		"internalType": "address"
	}, {"name": "paymaster", "type": "address", "indexed": true, "internalType": "address"}, {
		"name": "nonce",
		"type": "uint256",
		"indexed": false,
		"internalType": "uint256"
	}, {"name": "success", "type": "bool", "indexed": false, "internalType": "bool"}, {
		"name": "actualGasCost",
		"type": "uint256",
		"indexed": false,
		"internalType": "uint256"
	}, {"name": "actualGasUsed", "type": "uint256", "indexed": false, "internalType": "uint256"}],
	"anonymous": false
}, {
	"name": "UserOperationPrefundTooLow",
	"type": "event",
	"inputs": [{"name": "userOpHash", "type": "bytes32", "indexed": true, "internalType": "bytes32"}, {
		"name": "sender",
		"type": "address",
		"indexed": true,
		"internalType": "address"
	}, {"name": "nonce", "type": "uint256", "indexed": false, "internalType": "uint256"}],
	"anonymous": false
}, {
	"name": "UserOperationRevertReason",
	"type": "event",
	"inputs": [{"name": "userOpHash", "type": "bytes32", "indexed": true, "internalType": "bytes32"}, {
		"name": "sender",
		"type": "address",
		"indexed": true,
		"internalType": "address"
	}, {"name": "nonce", "type": "uint256", "indexed": false, "internalType": "uint256"}, {
		"name": "revertReason",
		"type": "bytes",
		"indexed": false,
		"internalType": "bytes"
	}],
	"anonymous": false
}, {
	"name": "Withdrawn",
	"type": "event",
	"inputs": [{
		"name": "account",
		"type": "address",
		"indexed": true,
		"internalType": "address"
	}, {"name": "withdrawAddress", "type": "address", "indexed": false, "internalType": "address"}, {
		"name": "amount",
		"type": "uint256",
		"indexed": false,
		"internalType": "uint256"
	}],
	"anonymous": false
}, {
	"name": "addStake",
	"type": "function",
	"inputs": [{"name": "unstakeDelaySec", "type": "uint32", "internalType": "uint32"}],
	"outputs": [],
	"stateMutability": "payable"
}, {
	"name": "balanceOf",
	"type": "function",
	"inputs": [{"name": "account", "type": "address", "internalType": "address"}],
	"outputs": [{"name": "", "type": "uint256", "internalType": "uint256"}],
	"stateMutability": "view"
}, {
	"name": "delegateAndRevert",
	"type": "function",
	"inputs": [{"name": "target", "type": "address", "internalType": "address"}, {
		"name": "data",
		"type": "bytes",
		"internalType": "bytes"
	}],
	"outputs": [],
	"stateMutability": "nonpayable"
}, {
	"name": "depositTo",
	"type": "function",
	"inputs": [{"name": "account", "type": "address", "internalType": "address"}],
	"outputs": [],
	"stateMutability": "payable"
}, {
	"name": "deposits",
	"type": "function",
	"inputs": [{"name": "", "type": "address", "internalType": "address"}],
	"outputs": [{"name": "deposit", "type": "uint256", "internalType": "uint256"}, {
		"name": "staked",
		"type": "bool",
		"internalType": "bool"
	}, {"name": "stake", "type": "uint112", "internalType": "uint112"}, {
		"name": "unstakeDelaySec",
		"type": "uint32",
		"internalType": "uint32"
	}, {"name": "withdrawTime", "type": "uint48", "internalType": "uint48"}],
	"stateMutability": "view"
}, {
	"name": "getDepositInfo",
	"type": "function",
	"inputs": [{"name": "account", "type": "address", "internalType": "address"}],
	"outputs": [{
		"name": "info",
		"type": "tuple",
		"components": [{"name": "deposit", "type": "uint256", "internalType": "uint256"}, {
			"name": "staked",
			"type": "bool",
			"internalType": "bool"
		}, {"name": "stake", "type": "uint112", "internalType": "uint112"}, {
			"name": "unstakeDelaySec",
			"type": "uint32",
			"internalType": "uint32"
		}, {"name": "withdrawTime", "type": "uint48", "internalType": "uint48"}],
		"internalType": "struct IStakeManager.DepositInfo"
	}],
	"stateMutability": "view"
}, {
	"name": "getNonce",
	"type": "function",
	"inputs": [{"name": "sender", "type": "address", "internalType": "address"}, {
		"name": "key",
		"type": "uint192",
		"internalType": "uint192"
	}],
	"outputs": [{"name": "nonce", "type": "uint256", "internalType": "uint256"}],
	"stateMutability": "view"
}, {
	"name": "getSenderAddress",
	"type": "function",
	"inputs": [{"name": "initCode", "type": "bytes", "internalType": "bytes"}],
	"outputs": [],
	"stateMutability": "nonpayable"
}, {
	"name": "getUserOpHash",
	"type": "function",
	"inputs": [{
		"name": "userOp",
		"type": "tuple",
		"components": [{"name": "sender", "type": "address", "internalType": "address"}, {
			"name": "nonce",
			"type": "uint256",
			"internalType": "uint256"
		}, {"name": "initCode", "type": "bytes", "internalType": "bytes"}, {
			"name": "callData",
			"type": "bytes",
			"internalType": "bytes"
		}, {"name": "accountGasLimits", "type": "bytes32", "internalType": "bytes32"}, {
			"name": "preVerificationGas",
			"type": "uint256",
			"internalType": "uint256"
		}, {"name": "gasFees", "type": "bytes32", "internalType": "bytes32"}, {
			"name": "paymasterAndData",
			"type": "bytes",
			"internalType": "bytes"
		}, {"name": "signature", "type": "bytes", "internalType": "bytes"}],
		"internalType": "struct PackedUserOperation"
	}],
	"outputs": [{"name": "", "type": "bytes32", "internalType": "bytes32"}],
	"stateMutability": "view"
}, {
	"name": "handleAggregatedOps",
	"type": "function",
	"inputs": [{
		"name": "opsPerAggregator",
		"type": "tuple[]",
		"components": [{
			"name": "userOps",
			"type": "tuple[]",
			"components": [{"name": "sender", "type": "address", "internalType": "address"}, {
				"name": "nonce",
				"type": "uint256",
				"internalType": "uint256"
			}, {"name": "initCode", "type": "bytes", "internalType": "bytes"}, {
				"name": "callData",
				"type": "bytes",
				"internalType": "bytes"
			}, {
				"name": "accountGasLimits",
				"type": "bytes32",
				"internalType": "bytes32"
			}, {"name": "preVerificationGas", "type": "uint256", "internalType": "uint256"}, {
				"name": "gasFees",
				"type": "bytes32",
				"internalType": "bytes32"
			}, {"name": "paymasterAndData", "type": "bytes", "internalType": "bytes"}, {
				"name": "signature",
				"type": "bytes",
				"internalType": "bytes"
			}],
			"internalType": "struct PackedUserOperation[]"
		}, {"name": "aggregator", "type": "address", "internalType": "contract IAggregator"}, {
			"name": "signature",
			"type": "bytes",
			"internalType": "bytes"
		}],
		"internalType": "struct IEntryPoint.UserOpsPerAggregator[]"
	}, {"name": "beneficiary", "type": "address", "internalType": "address payable"}],
	"outputs": [],
	"stateMutability": "nonpayable"
}, {
	"name": "handleOps",
	"type": "function",
	"inputs": [{
		"name": "ops",
		"type": "tuple[]",
		"components": [{"name": "sender", "type": "address", "internalType": "address"}, {
			"name": "nonce",
			"type": "uint256",
			"internalType": "uint256"
		}, {"name": "initCode", "type": "bytes", "internalType": "bytes"}, {
			"name": "callData",
			"type": "bytes",
			"internalType": "bytes"
		}, {"name": "accountGasLimits", "type": "bytes32", "internalType": "bytes32"}, {
			"name": "preVerificationGas",
			"type": "uint256",
			"internalType": "uint256"
		}, {"name": "gasFees", "type": "bytes32", "internalType": "bytes32"}, {
			"name": "paymasterAndData",
			"type": "bytes",
			"internalType": "bytes"
		}, {"name": "signature", "type": "bytes", "internalType": "bytes"}],
		"internalType": "struct PackedUserOperation[]"
	}, {"name": "beneficiary", "type": "address", "internalType": "address payable"}],
	"outputs": [],
	"stateMutability": "nonpayable"
}, {
	"name": "incrementNonce",
	"type": "function",
	"inputs": [{"name": "key", "type": "uint192", "internalType": "uint192"}],
	"outputs": [],
	"stateMutability": "nonpayable"
}, {
	"name": "innerHandleOp",
	"type": "function",
	"inputs": [{"name": "callData", "type": "bytes", "internalType": "bytes"}, {
		"name": "opInfo",
		"type": "tuple",
		"components": [{
			"name": "mUserOp",
			"type": "tuple",
			"components": [{"name": "sender", "type": "address", "internalType": "address"}, {
				"name": "nonce",
				"type": "uint256",
				"internalType": "uint256"
			}, {"name": "verificationGasLimit", "type": "uint256", "internalType": "uint256"}, {
				"name": "callGasLimit",
				"type": "uint256",
				"internalType": "uint256"
			}, {
				"name": "paymasterVerificationGasLimit",
				"type": "uint256",
				"internalType": "uint256"
			}, {
				"name": "paymasterPostOpGasLimit",
				"type": "uint256",
				"internalType": "uint256"
			}, {"name": "preVerificationGas", "type": "uint256", "internalType": "uint256"}, {
				"name": "paymaster",
				"type": "address",
				"internalType": "address"
			}, {"name": "maxFeePerGas", "type": "uint256", "internalType": "uint256"}, {
				"name": "maxPriorityFeePerGas",
				"type": "uint256",
				"internalType": "uint256"
			}],
			"internalType": "struct EntryPoint.MemoryUserOp"
		}, {"name": "userOpHash", "type": "bytes32", "internalType": "bytes32"}, {
			"name": "prefund",
			"type": "uint256",
			"internalType": "uint256"
		}, {"name": "contextOffset", "type": "uint256", "internalType": "uint256"}, {
			"name": "preOpGas",
			"type": "uint256",
			"internalType": "uint256"
		}],
		"internalType": "struct EntryPoint.UserOpInfo"
	}, {"name": "context", "type": "bytes", "internalType": "bytes"}],
	"outputs": [{"name": "actualGasCost", "type": "uint256", "internalType": "uint256"}],
	"stateMutability": "nonpayable"
}, {
	"name": "nonceSequenceNumber",
	"type": "function",
	"inputs": [{"name": "", "type": "address", "internalType": "address"}, {
		"name": "",
		"type": "uint192",
		"internalType": "uint192"
	}],
	"outputs": [{"name": "", "type": "uint256", "internalType": "uint256"}],
	"stateMutability": "view"
}, {
	"name": "supportsInterface",
	"type": "function",
	"inputs": [{"name": "interfaceId", "type": "bytes4", "internalType": "bytes4"}],
	"outputs": [{"name": "", "type": "bool", "internalType": "bool"}],
	"stateMutability": "view"
}, {
	"name": "unlockStake",
	"type": "function",
	"inputs": [],
	"outputs": [],
	"stateMutability": "nonpayable"
}, {
	"name": "withdrawStake",
	"type": "function",
	"inputs": [{"name": "withdrawAddress", "type": "address", "internalType": "address payable"}],
	"outputs": [],
	"stateMutability": "nonpayable"
}, {
	"name": "withdrawTo",
	"type": "function",
	"inputs": [{
		"name": "withdrawAddress",
		"type": "address",
		"internalType": "address payable"
	}, {"name": "withdrawAmount", "type": "uint256", "internalType": "uint256"}],
	"outputs": [],
	"stateMutability": "nonpayable"
}, {"type": "receive", "stateMutability": "payable"}]
