const axios = require('axios');
const FormData = require('form-data');
const { getAccessToken } = require('../utils/accessToken');

module.exports = async (req, res) => {
  // 1. 仅允许 POST 请求
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 2. 从请求体中获取图片 Buffer
  const { imageBuffer } = req.body; 
  if (!imageBuffer) {
    return res.status(400).json({ error: '缺少 imageBuffer 参数' });
  }

  // 3. 将 Buffer 转换为 Base64 字符串
  const base64Image = imageBuffer.toString('base64');
  const buffer = Buffer.from(base64Image, 'base64');

  try {
    // 4. 获取 access_token
    const accessToken = await getAccessToken();

    // 5. 构建 FormData
    const form = new FormData();
    form.append('media', buffer, {
      filename: 'image.jpg',
      contentType: 'image/jpeg',
    });

    // 6. 调用微信 imgSecCheck 接口
    const response = await axios.post(
      `https://api.weixin.qq.com/wxa/img_sec_check?access_token=${accessToken}`,
      form,
      { headers: form.getHeaders() }
    );

    // 7. 返回审核结果 (errcode: 0表示正常，87014表示违规)
    res.json(response.data);
  } catch (err) {
    console.error('/api/imgSecCheck 错误:', err.message);
    if (err.response) {
      return res.status(err.response.status || 500).json(err.response.data);
    }
    res.status(500).json({ error: '服务器内部错误' });
  }
};
