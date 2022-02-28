const superagent = require('superagent');

class RecaptchaService {
  constructor(app) {
    this.app = app;
  }

  // see https://developers.google.com/recaptcha/docs/verify
  // response is: {
  //     "success": true|false,
  //     "challenge_ts": timestamp,  // timestamp of the challenge load (ISO format yyyy-MM-dd'T'HH:mm:ssZZ)
  //     "hostname": string,         // the hostname of the site where the reCAPTCHA was solved
  //     "error-codes": [...]        // optional
  // }
  async verify(token) {
    const {
      app: { config, logger },
    } = this;

    logger.info({ src: 'RecaptchaService.verify', msg: `report request, token:${token}` });
    const response = await superagent.post(`${config.recaptchaUrl}`)
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send({ secret: config.recaptchaToken, response: token })
      .timeout(60 * 1000);
    const responseText = JSON.parse(response?.text);
    if (response.status !== 200 || !responseText?.success) {
      logger.error({ src: 'RecaptchaService.verify', msg: `report fail, token:${token}, siteVerifyResponse:${response?.text}` });
      return { code: 9999, msg: responseText['error-codes'] || 'bad-http-status' };
    }
    logger.info({ src: 'RecaptchaService.verify', msg: `report response, token:${token}, siteVerifyResponse:${response?.text}` });

    return { code: 0, msg: 'success' };
  }
}

module.exports = RecaptchaService;
