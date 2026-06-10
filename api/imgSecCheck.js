const axios = require('axios');
const FormData = require('form-data');
const sharp = require('sharp');
const { getAccessToken } = require('../utils/accessToken');

// 微信接口限制
const MAX_WIDTH = 750;
const MAX_HEIGHT = 1334;
const MAX_SIZE_BYTES = 1 * 1024 * 1024; // 1MB

/**
 * 压缩图片至符合微信检测要求
 * @param {Buffer} inputBuffer 原始图片Buffer
 * @returns {Promise<Buffer>} 压缩后的Buffer
 */
async function compressImage(inputBuffer) {
  let image = sharp(inputBuffer);
  const metadata = await image.metadata();

  let { width, height } = metadata;
  let needResize = false;
  let ratio = 1;

  // 1. 分辨率压缩：保持宽高比，确保宽≤750且高≤1334
  if (width > MAX_WIDTH) {
    ratio = Math.min(ratio, MAX_WIDTH / width);
    needResize = true;
  }
  if (height > MAX_HEIGHT) {
    ratio = Math.min(ratio, MAX_HEIGHT / height);
    needResize = true;
  }

  if (needResize) {
    const newWidth = Math.floor(width * ratio);
    const newHeight = Math.floor(height * ratio);
    image = image.resize(newWidth, newHeight);
  }

  // 2. 先尝试中等质量压缩
  let quality = 80;
  let compressedBuffer = await image.jpeg({ quality }).toBuffer();

  // 3. 循环降低质量直至文件大小 ≤ 1MB（最多降到20）
  while (compressedBuffer.length > MAX_SIZE_BYTES && quality > 20) {
    quality -= 10;
    compressedBuffer = await image.jpeg({ quality }).toBuffer();
  }

  // 如果依然超过1MB，最后一步：强制将尺寸缩放到更小（例如最长边500px）
  if (compressedBuffer.length > MAX_SIZE_BYTES) {
    image = sharp(inputBuffer).resize(500, 500, { fit: 'inside' });
    compressedBuffer = await image.jpeg({ quality: 70 }).toBuffer();
  }

  return compressedBuffer;
}

module.exports = async (req, res) => {
  // 1. 仅允许 POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 2. 获取图片数据（支持两种传入方式：Base64 或 直接 Buffer）
  let imageBuffer;
  if (req.body.imageBuffer) {
    // 前端传 Base64 字符串
    imageBuffer = Buffer.from(req.body.imageBuffer, 'base64');
  } else if (req.body.image) {
    // 兼容其他命名
    imageBuffer = Buffer.from(req.body.image, 'base64');
  } else if (req.body.buffer) {
    imageBuffer = req.body.buffer;
  } else {
    return res.status(400).json({ error: '缺少图片数据 (imageBuffer 字段)' });
  }

  try {
    // 3. 压缩图片
    const compressedBuffer = await compressImage(imageBuffer);

    // 4. 获取 access_token
    const accessToken = await getAccessToken();

    // 5. 构建 FormData 并调用微信接口
    const form = new FormData();
    form.append('media', compressedBuffer, {
      filename: 'image.jpg',
      contentType: 'image/jpeg',
    });

    const response = await axios.post(
      `https://api.weixin.qq.com/wxa/img_sec_check?access_token=${accessToken}`,
      form,
      { headers: form.getHeaders() }
    );

    // 6. 返回微信审核结果
    res.json(response.data);
  } catch (err) {
    console.error('/api/imgSecCheck 错误:', err.message);
    if (err.response) {
      return res.status(err.response.status || 500).json(err.response.data);
    }
    res.status(500).json({ error: '服务器内部错误' });
  }
};
