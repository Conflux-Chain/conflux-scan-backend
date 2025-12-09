import {
	AddressTransactionIndex,
	FullBlock,
	FullBlockExt,
	FullTransaction,
	IFailedTx
} from "../model/FullBlock";
import {IPosRegister} from "../model/PoS";
import {IAddressCfxTransfer, ICfxTransfer, ITrace} from "../model/CfxTransfer";
import {IEpochHashCfxTransfer} from "../CfxTransferSync";
import {ITraceCreateContract} from "../model/TraceCreateContract";
import {ESpaceHexMapAttributes} from "../model/HexMap";

export class BatchDataBase {
	batchSize: number

	enable: boolean
	safeCatchupGap: number
	initialTaskCount: number
	saveAtSize: number

	constructor() {
		this.safeCatchupGap = 600;
		this.initialTaskCount = 300;
		this.saveAtSize = 100;
	}

	shouldWaitBatch() {
		return this.enable && this.batchSize < this.saveAtSize
	}

	public enableByGap(cursor:number, target:number) {
		if (cursor < target - this.safeCatchupGap) {
			this.enable = true;
		}
		return this.enable;
	}
}

export class CfxTransferEpochData {
	result?: ITrace[]
	addrBeans?: IAddressCfxTransfer[]
	code: number
	epoch?: number
	pivotHash?: string
	parentHash?: string
	traceRpcMs?: number
	buildTime?: number
	contractCreationArr?: ITraceCreateContract[]
	crossSpaceAddrArr?: ESpaceHexMapAttributes[]
}

export class BatchTokenTransfer extends BatchDataBase {
	constructor() {
		super();
		this.reset();
	}
	t20: any[];
	t20addr: any[];
	t721: any[];  t721addr: any[];
	t1155: any[];  t1155addr: any[];
	approvals: any[];  relations: any[];  epochHash: any[];  nfts: any[]

	enqueue(data:any, epoch: number) {
		const {t20, t20addr, t721, t721addr, t1155, t1155addr, approvals, relations, pivotHash, nfts} = data
		this.t20.push(...t20);
		this.t20addr.push(...t20addr);
		this.t721.push(...t721);
		this.t721addr.push(...t721addr);
		this.t1155.push(...t1155);
		this.t1155addr.push(...t1155addr);
		this.approvals.push(...approvals);
		this.relations.push(...relations);
		this.nfts.push(...nfts);
		this.epochHash.push({epoch, hash: pivotHash});

		this.batchSize++;
	}

	reset() {
		this.t20 = [];
		this.t20addr = [];
		this.t721 = [];
		this.t721addr = [];
		this.t1155 = [];
		this.t1155addr = [];
		this.approvals = [];
		this.relations = [];
		this.nfts = [];
		this.epochHash = [];


		this.batchSize = 0
	}
}

export class BatchCfxTransfer extends BatchDataBase {
	traceArr: ITrace[]
	addrBeans: IAddressCfxTransfer[]
	pivotHashArr: IEpochHashCfxTransfer[]
	contractCreationArr: ITraceCreateContract[]
	crossSpaceAddrArr: ESpaceHexMapAttributes[]
	transferCount: number
	lastEpoch: number

	constructor() {
		super();
		this.reset();
	}

	enqueue(data: CfxTransferEpochData) {
		const {result, addrBeans, pivotHash, epoch, contractCreationArr, crossSpaceAddrArr} = data;
		if (result.length) {
			this.transferCount += result.length;
			this.traceArr.push(...result);
			this.addrBeans.push(...addrBeans);
		}
		this.contractCreationArr.push(...contractCreationArr);
		this.crossSpaceAddrArr.push(...crossSpaceAddrArr);

		this.pivotHashArr.push({epoch, hash: pivotHash});
		this.lastEpoch = epoch;

		this.batchSize++
	}

	reset() {
		this.traceArr = []
		this.addrBeans = []
		this.pivotHashArr = []
		this.contractCreationArr = []
		this.crossSpaceAddrArr = []
		this.transferCount = 0
		this.lastEpoch = -1

		this.batchSize = 0
	}
}

export class BatchBlockTx extends BatchDataBase{
	failedTX: IFailedTx[]
	fullBlock: FullBlock[]
	fullTransaction: FullTransaction[]
	addressTransactionIndex: AddressTransactionIndex[]
	fullBlockExt: FullBlockExt[]
	posRegArr: IPosRegister[]

	constructor() {
		super();
		this.reset();
	}

	enqueue(
		failedTX: IFailedTx[],
		fullBlock: FullBlock[],
		fullTransaction: FullTransaction[],
		addressTransactionIndex: AddressTransactionIndex[],
		fullBlockExt: FullBlockExt[],
		posRegArr: IPosRegister[],
	) {
		this.failedTX.push(...failedTX)
		this.fullBlock.push(...fullBlock)
		this.fullTransaction.push(...fullTransaction)
		this.addressTransactionIndex.push(...addressTransactionIndex)
		this.fullBlockExt.push(...fullBlockExt)
		this.posRegArr.push(...posRegArr)

		this.batchSize++
	}

	//
	reset() {
		// https://stackoverflow.com/questions/1232040/how-do-i-empty-an-array-in-javascript
		this.failedTX = []
		this.fullBlock = []
		this.fullTransaction = []
		this.addressTransactionIndex = []
		this.fullBlockExt = []
		this.posRegArr = []

		this.batchSize = 0
	}

	//
}
