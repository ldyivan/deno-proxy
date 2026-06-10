const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

// ---------- 从环境变量读取敏感信息 ----------
// 在 Vercel 项目中添加环境变量：APPID, APPSECRET
const APPID = process.env.APPID;
const APPSECRET = process.env.APPSECRET;

if (!APPID || !APPSECRET) {
  console.error('错误：请在环境变量中设置 APPID 和 APPSECRET');
}

// ---------- 辅助函数：获取 access_token（带简单内存缓存） ----------
let cachedToken = null;
let tokenExpireTime = 0;

async function getAccessToken() {
  // 如果缓存未过期，直接返回
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

// ---------- 接口1：登录换 openid ----------
app.post('/api/login', async (req, res) => {
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

    // 返回 openid 和 session_key（session_key 通常不需要给前端）
    res.json({
      openid: response.data.openid,
      session_key: response.data.session_key  // 如需使用可返回，但注意安全
    });
  } catch (err) {
    console.error('/api/login 错误:', err.message);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// ---------- 接口2：获取用户风险等级 ----------
app.post('/api/getUserRiskRank', async (req, res) => {
  const { openid, scene, client_ip, mobile_no, email_address, extended_info } = req.body;

  if (!openid || !scene || !client_ip) {
    return res.status(400).json({ error: '缺少必要参数: openid, scene, client_ip' });
  }

  try {
    const accessToken = await getAccessToken();
    const wxApiUrl = `https://api.weixin.qq.com/wxa/getuserriskrank?access_token=${accessToken}`;

    const payload = {
      appid: APPID,
      openid,
      scene,
      client_ip,
      mobile_no: mobile_no || '',
      email_address: email_address || '',
      extended_info: extended_info || ''
    };

    const response = await axios.post(wxApiUrl, payload, {
      headers: { 'Content-Type': 'application/json' }
    });

    // 直接透传微信返回的数据
    res.json(response.data);
  } catch (err) {
    console.error('/api/getUserRiskRank 错误:', err.message);
    if (err.response) {
      // 微信接口返回的错误信息
      return res.status(err.response.status || 500).json(err.response.data);
    }
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// 健康检查（可选）
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// 导出 Express 应用（Vercel 会用它来处理请求）
module.exports = app;
