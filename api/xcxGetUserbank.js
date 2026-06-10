// api/xcxGetUserbank.js
const axios = require('axios');
const { getAccessToken } = require('../utils/accessToken');

const APPID = process.env.APPID;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { openid, scene, mobile_no, email_address, extended_info } = req.body;

  if (!openid || !scene) {
    return res.status(400).json({ error: '缺少必要参数: openid, scene' });
  }

  // 从请求头获取真实客户端 IP（Vercel 会传递 X-Forwarded-For）
  const client_ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;

  try {
    const accessToken = await getAccessToken();

    const payload = {
      appid: APPID,
      openid,
      scene,
      client_ip,
      mobile_no: mobile_no || '',
      email_address: email_address || '',
      extended_info: extended_info || ''
    };

    const response = await axios.post(
      `https://api.weixin.qq.com/wxa/getuserriskrank?access_token=${accessToken}`,
      payload,
      { headers: { 'Content-Type': 'application/json' } }
    );

    // 透传微信返回的结果
    res.json(response.data);
  } catch (err) {
    console.error('/api/xcxGetUserbank 错误:', err.message);
    if (err.response) {
      return res.status(err.response.status || 500).json(err.response.data);
    }
    res.status(500).json({ error: '服务器内部错误' });
  }
};
