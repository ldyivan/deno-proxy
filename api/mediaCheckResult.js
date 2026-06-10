const axios = require('axios');
const { getAccessToken } = require('../utils/accessToken');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { trace_id } = req.body;
  if (!trace_id) {
    return res.status(400).json({ error: '缺少 trace_id 参数' });
  }

  try {
    const accessToken = await getAccessToken();
    const response = await axios.post(
      `https://api.weixin.qq.com/wxa/get_media_check_async_result?access_token=${accessToken}`,
      { trace_id },
      { headers: { 'Content-Type': 'application/json' } }
    );

    res.json(response.data);
  } catch (err) {
    console.error('/api/mediaCheckResult 错误:', err.message);
    res.status(500).json({ error: '查询失败' });
  }
};
