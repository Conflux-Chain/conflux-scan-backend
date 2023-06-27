const { format } = require('js-conflux-sdk');
const { KV, ANNOUNCEMENT_CONTRACT } = require('../../stat/dist/model/KV');

class AnnounceService {
  constructor(app) {
    this.app = app;

    const {
      app: { config, cfx },
    } = this;

    this._sendLocked = false;
    try {
      this.announcer = cfx.wallet.addPrivateKey(config.announcer);
    } catch (e) {
      this.announcer = config.announcer;
    }
  }

  async send(array) {
    const {
      app: { config, cfx, tool, error, service, tokenTool },
    } = this;

    tool.assert(Array.isArray(array), `AnnounceService.send(array) must be array, got "${array}"`);

    const address = config.announcementAddress;
    if (!await service.conflux.getCode(address)) {
      throw new error.AnnouncementNotExistError(`Announce address "${address}" not deployed yet`);
    }

    const groupArray = this._splitAnnounceArray(array);

    if (this._sendLocked) {
      throw new error.ApiBusyError('Announcer is busy, try again later');
    }
    try {
      this._sendLocked = true;

      const nonce = await cfx.getNextNonce(this.announcer);
      let { announcementAddress } = config;
      const dbConfigAdd = await KV.getString(ANNOUNCEMENT_CONTRACT, '');
      if (dbConfigAdd !== '') {
        announcementAddress = dbConfigAdd;
      }
      return await Promise.all(groupArray.map(
        async (group, index) => tokenTool.sendAnnounceTransaction(group, {
          nonce: Number(nonce) + index,
          from: this.announcer,
          to: announcementAddress,
          gasPrice: 5000000000,
        }),
      ));
    } catch (e) {
      throw new error.SendAnnounceError(e.data || e); // RPCError || Error
    } finally {
      this._sendLocked = false;
    }
  }

  _splitAnnounceArray(array) {
    const {
      app: { error, CONST },
    } = this;

    array = array.filter((each) => each.value !== undefined);
    array = array.map(({ key, value }) => ({ key: this._getBytes(key), value: this._getBytes(value) }));

    const groupArray = [];

    let group = [];
    let groupSize = 0;
    array.forEach(({ key, value }) => {
      const size = key.length + value.length;

      if (size > CONST.ANNOUNCE_MAX_SIZE) {
        throw new error.AnnounceTooLongError(`key "${key}" and data size ${size} > maximum bytes ${CONST.ANNOUNCE_MAX_SIZE}`);
      }

      if (groupSize + size > CONST.ANNOUNCE_MAX_SIZE) {
        groupArray.push(group);
        group = [];
        groupSize = 0;
      }

      group.push({ key, value });
      groupSize += size;
    });
    groupArray.push(group);

    return groupArray;
  }

  _getBytes(v){
    return Buffer.isBuffer(v) ? v : Buffer.from(v);
  }

  async query({ address, announcer, ...rest }) {
    const {
      app: { config, syncSDK, ttlMap },
    } = this;

    address = address || config.announcementAddress;
    announcer = announcer || `${this.announcer}`;

    const announce = await ttlMap.cache(`AnnounceService.query(${JSON.stringify({ address, announcer, ...rest })})`,
      () => syncSDK.queryAnnounce({ address, announcer, ...rest }), // announcer might be Account instance
      { ttl: 60 * 1000 },
    );

    return announce || {};
  }

  /**
   * @param address
   * @param announcer
   * @param rest
   * @return {Promise<{list:[]}>}
   */
  async list({ address, announcer, ...rest }) {
    const {
      app: { config, syncSDK },
    } = this;

    address = address || config.announcementAddress;
    announcer = announcer || `${this.announcer}`;

    return syncSDK.listAnnounce({ address, announcer, ...rest }); // announcer might be Account instance
  }
}

module.exports = AnnounceService;
