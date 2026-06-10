// api/msgSecCheck.js
const axios = require('axios');
// 引入之前写好的 accessToken 管理模块
const { getAccessToken } = require('../utils/accessToken');

const APPID = process.env.APPID;

module.exports = async (req, res) => {
  // 1. 仅允许 POST 方法
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 2. 从请求体中获取必要参数
  const { content, openid, scene, title, nickname, signature } = req.body;

  // 3. 验证必填项 (content, openid, scene 都是必填)
  if (!content || !openid || !scene) {
    return res.status(400).json({ error: '缺少必要参数: content, openid, scene' });
  }

  // 4. 调用共享的 accessToken 管理模块
  try {
    const accessToken = await getAccessToken();

    // 5. 构建微信 API 请求体 (参数与官方文档一致)
    const payload = {
      content: content,
      version: 2,                 // 官方要求固定值 2
      scene: scene,              // 场景枚举值: 1资料, 2评论, 3论坛, 4社交日志
      openid: openid,
      title: title || '',
      nickname: nickname || '',
      signature: signature || ''
    };

    // 6. 调用微信的 msgSecCheck 接口
    const response = await axios.post(
      `https://api.weixin.qq.com/wxa/msg_sec_check?access_token=${accessToken}`,
      payload,
      { headers: { 'Content-Type': 'application/json' } }
    );

    // 7. 直接将微信服务器的响应返回给小程序端
    res.json(response.data);
  } catch (err) {
    console.error('/api/msgSecCheck 错误:', err.message);
    if (err.response) {
      return res.status(err.response.status || 500).json(err.response.data);
    }
    res.status(500).json({ error: '服务器内部错误' });
  }
};
