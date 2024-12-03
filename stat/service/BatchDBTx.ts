import {
	AddressTransactionIndex,
	FullBlock,
	FullBlockExt,
	FullTransaction,
	IFailedTx
} from "../model/FullBlock";
import {IPosRegister} from "../model/PoS";
import {IAddressCfxTransfer, ICfxTransfer} from "../model/CfxTransfer";
import {IEpochHashCfxTransfer} from "../CfxTransferSync";

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
	result?: ICfxTransfer[]
	addrBeans?: IAddressCfxTransfer[]
	code: number
	epoch?: number
	pivotHash?: string
	parentHash?: string
}

export class BatchCfxTransfer extends BatchDataBase {
	cfxTransArr: ICfxTransfer[]
	addrBeans: IAddressCfxTransfer[]
	pivotHashArr: IEpochHashCfxTransfer[]
	transferCount: number
	lastEpoch: number

	constructor() {
		super();
		this.reset();
	}

	enqueue(data: CfxTransferEpochData) {
		const {result, addrBeans, pivotHash, epoch} = data;
		if (result.length) {
			this.transferCount += result.length;
			this.cfxTransArr.push(...result);
			this.addrBeans.push(...addrBeans);
		}
		this.pivotHashArr.push({epoch, hash: pivotHash});
		this.lastEpoch = epoch;
	}

	reset() {
		this.cfxTransArr = []
		this.addrBeans = []
		this.pivotHashArr = []
		this.transferCount = 0
		this.lastEpoch = -1
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
