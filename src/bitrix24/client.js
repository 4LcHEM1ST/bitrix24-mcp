import axios from 'axios';
import { RateLimiter } from '../utils/rate-limiter.js';

const MAX_RETRIES = 3;

export class Bitrix24Client {
  constructor(webhookUrl) {
    this.webhookUrl = webhookUrl.endsWith('/') ? webhookUrl : webhookUrl + '/';
    this.limiter = new RateLimiter(500);
    this.portal = this._extractPortal(webhookUrl);
    this.v3BaseUrl = this._buildV3Base(this.webhookUrl);
  }

  _extractPortal(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return 'unknown';
    }
  }

  // REST v3 methods (e.g. the mail.* family) live under a different base path:
  // classic is /rest/{user}/{token}/, v3 is /rest/api/{user}/{token}/. Derive the
  // v3 base from the configured webhook by inserting the `api` segment.
  _buildV3Base(url) {
    try {
      const u = new URL(url);
      u.pathname = u.pathname.replace(/^\/rest\//, '/rest/api/');
      return u.toString();
    } catch {
      return url.replace('/rest/', '/rest/api/');
    }
  }

  async call(method, params = {}, retries = 0) {
    return this.limiter.schedule(async () => {
      try {
        const url = `${this.webhookUrl}${method}.json`;
        const response = await axios.post(url, params, { timeout: 30000 });
        if (response.data.error) {
          throw new Error(`Bitrix24 error [${response.data.error}]: ${response.data.error_description}`);
        }
        return response.data;
      } catch (err) {
        if (err.response?.status === 429 && retries < MAX_RETRIES) {
          const retryAfter = parseInt(err.response.headers['retry-after'] || '2', 10);
          await new Promise(r => setTimeout(r, retryAfter * 1000));
          return this.call(method, params, retries + 1);
        }
        if (err.code === 'ECONNABORTED' && retries < MAX_RETRIES) {
          const backoff = Math.pow(2, retries) * 1000;
          await new Promise(r => setTimeout(r, backoff));
          return this.call(method, params, retries + 1);
        }
        throw err;
      }
    });
  }

  // Calls a REST v3 method (no `.json` suffix, /rest/api/ base). v3 wraps errors
  // in an { code, message } object instead of the classic error/error_description
  // string pair. Same rate limiting and retry policy as call().
  async callV3(method, params = {}, retries = 0) {
    return this.limiter.schedule(async () => {
      try {
        const url = `${this.v3BaseUrl}${method}`;
        const response = await axios.post(url, params, { timeout: 30000 });
        if (response.data.error) {
          const e = response.data.error;
          const code = e && typeof e === 'object' ? e.code : e;
          const message = e && typeof e === 'object' ? e.message : response.data.error_description;
          throw new Error(`Bitrix24 error [${code}]: ${message}`);
        }
        return response.data;
      } catch (err) {
        if (err.response?.status === 429 && retries < MAX_RETRIES) {
          const retryAfter = parseInt(err.response.headers['retry-after'] || '2', 10);
          await new Promise(r => setTimeout(r, retryAfter * 1000));
          return this.callV3(method, params, retries + 1);
        }
        if (err.code === 'ECONNABORTED' && retries < MAX_RETRIES) {
          const backoff = Math.pow(2, retries) * 1000;
          await new Promise(r => setTimeout(r, backoff));
          return this.callV3(method, params, retries + 1);
        }
        throw err;
      }
    });
  }
}
