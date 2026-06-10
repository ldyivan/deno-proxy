// utils/accessToken.js
const axios = require('axios');

const APPID = process.env.APPID;
const APPSECRET = process.env.APPSECRET;

let cachedToken = null;
let tokenExpireTime = 0;

async function getAccessToken() {
  // 缓存有效则直接返回
  if (cachedToken && Date.now() < tokenExpireTime) {
    return cachedToken;
  }

  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${APPID}&secret=${APPSECRET}`;
  const response = await axios.get(url);

  if (response.data.errcode) {
    throw new Error(`获取 access_token 失败: ${response.data.errmsg}`);
  }

  cachedToken = response.data.access_token;
  // 提前 5 分钟刷新，避免临界失效
  tokenExpireTime = Date.now() + (response.data.expires_in - 300) * 1000;
  return cachedToken;
}

module.exports = { getAccessToken };
