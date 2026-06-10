const axios = require('axios');
const { getAccessToken } = require('../utils/accessToken');

const APPID = process.env.APPID;

module.exports = async (req, res) => {
  // 1. 仅接受 POST 请求
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 2. 从请求体中获取必要参数
  const { openid, scene, media_url, media_type } = req.body;

  if (!openid || !scene || !media_url || !media_type) {
    return res.status(400).json({ error: '缺少必要参数: openid, scene, media_url, media_type' });
  }

  // 3. 获取 access_token 并调用微信接口
  try {
    const accessToken = await getAccessToken();
    const payload = {
      version: 2,          // 固定值 2
      openid,
      scene,               // 1资料 2评论 3论坛 4社交日志
      media_url,
      media_type,          // 1:音频 2:图片
    };

    const response = await axios.post(
      `https://api.weixin.qq.com/wxa/media_check_async?access_token=${accessToken}`,
      payload,
      { headers: { 'Content-Type': 'application/json' } }
    );

    // 微信返回 { errcode, errmsg, trace_id }
    res.json(response.data);
  } catch (err) {
    console.error('/api/mediaCheckAsync 错误:', err.message);
    if (err.response) {
      return res.status(err.response.status || 500).json(err.response.data);
    }
    res.status(500).json({ error: '服务器内部错误' });
  }
};
