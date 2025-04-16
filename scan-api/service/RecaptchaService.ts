import {ScanApp} from "./index";

const superagent = require('superagent');

export class RecaptchaService {
  app: ScanApp & any;
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
      app: { config,  },
    } = this;

    console.log('RecaptchaService.verify', `report request, token:${token}`);
    const response = await superagent.post(`${config.recaptchaUrl}`)
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send({ secret: config.recaptchaToken, response: token })
      .timeout(60 * 1000);
    const responseText = JSON.parse(response?.text);
    if (response.status !== 200 || !responseText?.success) {
      console.log('RecaptchaService.verify', `report fail, token:${token}, siteVerifyResponse:${response?.text}`);
      return { code: 9999, msg: responseText['error-codes'] || 'bad-http-status' };
    }
    console.log('RecaptchaService.verify', `report response, token:${token}, siteVerifyResponse:${response?.text}`);

    return { code: 0, msg: 'success' };
  }
}
