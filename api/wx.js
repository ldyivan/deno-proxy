const crypto = require('crypto');

const TOKEN = process.env.WX_TOKEN;
const API_URL = 'http://api.hzv5.cn/dysp.php';

// 读取请求体（流）
function getRawBodyFromReq(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => { resolve(data); });
    req.on('error', reject);
  });
}

// 微信签名验证
function checkSignature(signature, timestamp, nonce) {
  const arr = [TOKEN, timestamp, nonce].sort();
  const sha1 = crypto.createHash('sha1').update(arr.join('')).digest('hex');
  return sha1 === signature;
}

// 从 XML 中提取标签内容
function extractTag(xml, tag) {
  const cdataRegex = new RegExp(`<${tag}><\\!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`);
  let match = xml.match(cdataRegex);
  if (match) return match[1];
  const textRegex = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`);
  match = xml.match(textRegex);
  return match ? match[1].trim() : '';
}

// 提取抖音分享链接
function extractDouyinLink(text) {
  if (!text) return null;
  const regex = /https?:\/\/(v\.douyin\.com|iesdouyin\.com)\/[a-zA-Z0-9_]+\/?/;
  const match = text.match(regex);
  return match ? match[0] : null;
}

// 调用解析 API
async function parseDouyin(shareUrl) {
  const url = `${API_URL}?url=${encodeURIComponent(shareUrl)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.code !== 200) throw new Error(data.msg || '解析失败');
  return data.data;
}

// 辅助：提取图片链接数组（兼容数组或对象）
function extractImageUrls(urlField) {
  if (!urlField) return [];
  if (Array.isArray(urlField)) return urlField;
  if (typeof urlField === 'object') return Object.values(urlField);
  return [urlField];
}

// 格式化回复（极简显示，节省篇幅）
function formatResult(data) {
  const type = data.type;
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
    lines.push(`<a href="${videoUrl}">▶ 点击播放视频</a>`);
  } 
  else if (type === '图文') {
    const urls = extractImageUrls(data.url);
    const num = data.num || urls.length;
    lines.push(`类型：图文集`);
    lines.push(`共 ${num} 张图片`);
    // 每个图片只用“图片X”作为链接文本，不显示完整 URL
    urls.forEach((url, idx) => {
      lines.push(`<a href="${url}">图片${idx+1}</a>`);
    });
  } 
  else {
    lines.push(`未知类型：${JSON.stringify(data).substring(0, 100)}`);
  }

  return lines.join('\n');
}

// 构造回复 XML
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

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    const { signature, timestamp, nonce, echostr } = req.query;
    if (checkSignature(signature, timestamp, nonce)) {
      return res.status(200).send(echostr);
    }
    return res.status(401).send('Invalid signature');
  }

  if (req.method === 'POST') {
    try {
      const rawXml = await getRawBodyFromReq(req);
      const fromUser = extractTag(rawXml, 'FromUserName');
      const toUser = extractTag(rawXml, 'ToUserName');
      const content = extractTag(rawXml, 'Content');
      
      if (!content) {
        return res.status(200).send('success');
      }

      const douyinUrl = extractDouyinLink(content);
      let replyText = '';

      if (!douyinUrl) {
        replyText = '请发送抖音分享链接，例如：https://v.douyin.com/xxxxx/';
      } else {
        try {
          const parsed = await parseDouyin(douyinUrl);
          replyText = formatResult(parsed);
        } catch (err) {
          console.error('API错误:', err);
          replyText = `解析失败：${err.message}`;
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