// api/login.js
const axios = require('axios');

const APPID = process.env.APPID;
const APPSECRET = process.env.APPSECRET;

module.exports = async (req, res) => {
  // 只接受 POST 请求
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code } = req.body;
  if (!code) {
    return res.status(400).json({ error: '缺少 code 参数' });
  }

  try {
    const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${APPID}&secret=${APPSECRET}&js_code=${code}&grant_type=authorization_code`;
    const response = await axios.get(url);

    if (response.data.errcode) {
      return res.status(400).json({ error: response.data.errmsg });
    }

    // 返回 openid（session_key 通常不发给前端）
    res.json({
      openid: response.data.openid
    });
  } catch (err) {
    console.error('/api/login 错误:', err.message);
    res.status(500).json({ error: '服务器内部错误' });
  }
};
