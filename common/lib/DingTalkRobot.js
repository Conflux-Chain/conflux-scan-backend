const crypto = require('crypto');
const lodash = require('lodash');
const superagent = require('superagent');

class DingTalkRobot {
  constructor({
    url = 'https://oapi.dingtalk.com/robot/send',
    accessToken,
    secret,
    mobiles = [],
    ...tags
  } = {}) {
    this.url = url;
    this.accessToken = accessToken;
    this.secret = secret;
    this.mobiles = mobiles;
    this.tags = tags;
  }

  async send(data) {
    try {
      const timestamp = Date.now();

      let sign;
      if (this.secret) {
        sign = crypto.createHmac('sha256', this.secret)
          .update(`${timestamp}\n${this.secret}`)
          .digest()
          .toString('base64');
      }

      return superagent.post(this.url)
        .query({ access_token: this.accessToken, timestamp, sign })
        .send(data).then(res=>res.body);
    } catch (e) {
      return {error: e}
    }
  }

  sendMarkdown(title, text) {
    return this.send({
      msgtype: 'markdown',
      markdown: { title, text },
      at: { atMobiles: this.mobiles },
    });
  }

  // ==========================================================================
  sendObject(title, object = {}) {
    const date = new Date(Date.now());

    object = lodash.pickBy({ ...this.tags, ...object }, (v) => v !== undefined);
    const lines = lodash.map(object, (value, key) => {
      if (lodash.isObject(value)) {
        return [`* ${key}:`, '```', JSON.stringify(value, null, 2), '```'].join('\n');
      }
      return `* ${key}: ${value}`;
    });

    return this.sendMarkdown(title, `# ${title}\n*${date.toISOString()}*\n${lines.join('\n')}`);
  }

  sendError(e) {
    return this.sendObject(e.name, {
      message: e.message,
      stack: e.stack.split('\n'),
    });
  }
}

module.exports = DingTalkRobot;
