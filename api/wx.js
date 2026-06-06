// api/wx.js - 最终版（无emoji，长链接用a标签，图集全量展示）
const crypto = require('crypto');

const TOKEN = process.env.WX_TOKEN;
const API_URL = 'http://api.hzv5.cn/dysp.php';

// ========== 从请求流中读取原始数据 ==========
function getRawBodyFromReq(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => { resolve(data); });
    req.on('error', reject);
  });
}

// ========== 微信签名验证 ==========
function checkSignature(signature, timestamp, nonce) {
  const arr = [TOKEN, timestamp, nonce].sort();
  const sha1 = crypto.createHash('sha1').update(arr.join('')).digest('hex');
  return sha1 === signature;
}

// ========== 从 XML 中提取标签内容（支持 CDATA） ==========
function extractTag(xml, tag) {
  // 标准 CDATA 匹配
  const cdataRegex = new RegExp(`<${tag}><\\!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`);
  let match = xml.match(cdataRegex);
  if (match) return match[1];
  // 普通文本匹配
  const textRegex = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`);
  match = xml.match(textRegex);
  return match ? match[1].trim() : '';
}

// ========== 提取抖音链接 ==========
function extractDouyinLink(text) {
  if (!text) return null;
  const regex = /https?:\/\/(v\.douyin\.com|iesdouyin\.com)\/[a-zA-Z0-9_]+\/?/;
  const match = text.match(regex);
  return match ? match[0] : null;
}

// ========== 调用抖音解析 API ==========
async function parseDouyin(shareUrl) {
  const url = `${API_URL}?url=${encodeURIComponent(shareUrl)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.code !== 200) throw new Error(data.msg || '解析失败');
  return data.data;
}

// ========== 格式化回复（无 emoji，长链接直接加 <a> 标签） ==========
function formatResult(data) {
  const type = data.type;      // "视频" 或 "图文"
  const author = data.author || '未知';
  const title = data.title || '无标题';
  const like = data.like || 0;

  let lines = [
    `作者：${author}`,
    `标题：${title}`,
    `点赞：${like}`
  ];

  if (type === '视频') {
    const duration = data.duration ? `${Math.floor(data.duration / 1000)}秒` : '未知';
    const videoUrl = data.url;
    lines.push(`类型：视频`);
    lines.push(`时长：${duration}`);
    lines.push(`视频链接：<a href="${videoUrl}">${videoUrl}</a>`);
  } 
  else if (type === '图文') {
    const urls = data.url;            // 图片链接数组
    const num = data.num || (urls ? urls.length : 0);
    lines.push(`类型：图文集`);
    lines.push(`图片数量：${num}`);
    if (urls && urls.length) {
      // 遍历所有图片，每个都生成 a 标签，不省略
      urls.forEach((url, idx) => {
        lines.push(`图片${idx+1}：<a href="${url}">${url}</a>`);
      });
    }
  } 
  else {
    lines.push(`未知类型，原始数据：${JSON.stringify(data).substring(0, 200)}`);
  }

  return lines.join('\n');
}

// ========== 构建回复 XML ==========
function buildReply(toUser, fromUser, content) {
  const timestamp = Math.floor(Date.now() / 1000);
  return `<xml>
  <ToUserName><![CDATA[${toUser}]]></ToUserName>
  <FromUserName><![CDATA[${fromUser}]]></FromUserName>
  <CreateTime>${timestamp}</CreateTime>
  <MsgType><![CDATA[text]]></MsgType>
  <Content><![CDATA[${content}]]></Content>
</xml>`;
}

// ========== Vercel 主函数 ==========
module.exports = async (req, res) => {
  // GET 请求：微信服务器验证
  if (req.method === 'GET') {
    const { signature, timestamp, nonce, echostr } = req.query;
    if (checkSignature(signature, timestamp, nonce)) {
      return res.status(200).send(echostr);
    }
    return res.status(401).send('Invalid signature');
  }

  // POST 请求：处理用户消息
  if (req.method === 'POST') {
    try {
      const rawXml = await getRawBodyFromReq(req);
      console.log('rawXml 长度:', rawXml.length);

      const fromUser = extractTag(rawXml, 'FromUserName');
      const toUser = extractTag(rawXml, 'ToUserName');
      let content = extractTag(rawXml, 'Content');
      const msgType = extractTag(rawXml, 'MsgType');

      console.log(`提取结果: from=${fromUser}, msgType=${msgType}, content=${content}`);

      // 如果没有提取到文本内容，返回调试信息（可选，正式环境可删除）
      if (!content) {
        // 若不需要调试，可直接返回 success
        return res.status(200).send('success');
      }

      // 提取抖音链接
      const douyinUrl = extractDouyinLink(content);
      let replyText = '';

      if (!douyinUrl) {
        replyText = '请发送抖音分享链接，例如：https://v.douyin.com/xxxxx/';
      } else {
        try {
          const parsed = await parseDouyin(douyinUrl);
          replyText = formatResult(parsed);
        } catch (err) {
          console.error('API 错误:', err);
          replyText = `解析失败：${err.message}\n请检查链接是否正确。`;
        }
      }

      const replyXml = buildReply(fromUser, toUser, replyText);
      res.setHeader('Content-Type', 'application/xml');
      return res.status(200).send(replyXml);
    } catch (err) {
      console.error('严重错误:', err);
      return res.status(200).send('success');
    }
  }

  res.status(405).send('Method Not Allowed');
};