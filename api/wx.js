const crypto = require('crypto');

const TOKEN = process.env.WX_TOKEN;
const API_URL = 'http://api.hzv5.cn/dysp.php';
const MAX_BYTES = 2000;

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

// 从 XML 中提取标签内容（支持 CDATA）
function extractTag(xml, tag) {
  const cdataRegex = new RegExp(`<${tag}><\\!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`);
  let match = xml.match(cdataRegex);
  if (match) return match[1];
  const textRegex = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`);
  match = xml.match(textRegex);
  return match ? match[1].trim() : '';
}

// 提取抖音链接（支持短横线）
function extractDouyinLink(text) {
  if (!text) return null;
  const regex = /https?:\/\/(v\.douyin\.com|iesdouyin\.com)\/[a-zA-Z0-9_-]+\/?/;
  const match = text.match(regex);
  return match ? match[0] : null;
}

// 调用抖音解析 API
async function parseDouyin(shareUrl) {
  const url = `${API_URL}?url=${encodeURIComponent(shareUrl)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.code !== 200) throw new Error(data.msg || '解析失败');
  return data.data;
}

// 提取图片链接（兼容对象/数组）
function extractImageUrls(urlField) {
  if (!urlField) return [];
  if (Array.isArray(urlField)) return urlField;
  if (typeof urlField === 'object') return Object.values(urlField);
  return [urlField];
}

// 缩短标题
function shortenTitle(title, maxLen = 15) {
  if (!title) return '无标题';
  if (title.length <= maxLen) return title;
  return title.substring(0, maxLen) + '…';
}

// 构建头部（作者 | 标题 | 点赞）
function buildHeader(data) {
  const author = data.author || '未知';
  const title = shortenTitle(data.title);
  const like = data.like || 0;
  return `${author} | ${title} | ❤️${like}`;
}

// 智能控制长度的图文集回复
function buildFullReply(data) {
  const type = data.type;
  const header = buildHeader(data);
  const lines = [header];

  if (type === '视频') {
    lines.push(`<a href="${data.url}">▶ 观看视频</a>`);
    return lines.join('\n');
  }

  if (type !== '图文') {
    lines.push(`未知类型：${JSON.stringify(data).substring(0, 100)}`);
    return lines.join('\n');
  }

  const allUrls = extractImageUrls(data.url);
  const totalNum = data.num || allUrls.length;
  lines.push(`📷 共${totalNum}张图`);

  let currentUrls = [...allUrls];
  let replyText = '';

  while (currentUrls.length > 0) {
    const testLines = [...lines];
    currentUrls.forEach((url, idx) => {
      testLines.push(`<a href="${url}">图${idx+1}</a>`);
    });
    const testText = testLines.join('\n');
    const byteLength = Buffer.byteLength(testText, 'utf8');
    if (byteLength <= MAX_BYTES) {
      replyText = testText;
      break;
    } else {
      if (currentUrls.length === 1) {
        replyText = testText;
        break;
      }
      currentUrls.pop();
    }
  }

  if (replyText && currentUrls.length < allUrls.length) {
    replyText += `\n(仅显示前${currentUrls.length}张，共${totalNum}张)`;
  }
  return replyText || (lines.join('\n') + '\n(无法生成回复)');
}

// 构建回复 XML
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
  // GET: 微信服务器验证
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
      const msgType = extractTag(rawXml, 'MsgType');

      // ---------- 处理事件消息（菜单点击、关注等）----------
      if (msgType === 'event') {
        const event = extractTag(rawXml, 'Event');
        if (event === 'CLICK') {
          const eventKey = extractTag(rawXml, 'EventKey');
          let replyContent = '';
          if (eventKey === 'help_usage') {
            replyContent = '欢迎使用抖音解析助手。\n发送抖音分享链接，我将为您解析视频或图文内容。';
          } else if (eventKey === 'help_about') {
            replyContent = '本服务由 api.hzv5.cn 提供抖音解析接口。';
          } else {
            replyContent = '未知指令，请点击菜单中的“帮助”。';
          }
          const replyXml = buildReply(fromUser, toUser, replyContent);
          res.setHeader('Content-Type', 'application/xml');
          return res.status(200).send(replyXml);
        }
        // 其他事件（subscribe, unsubscribe 等）忽略，不回复
        return res.status(200).send('success');
      }

      // ---------- 处理文本消息 ----------
      if (msgType !== 'text') {
        return res.status(200).send('success');
      }

      const content = extractTag(rawXml, 'Content');
      if (!content) {
        return res.status(200).send('success');
      }

      const douyinUrl = extractDouyinLink(content);
      if (!douyinUrl) {
        // 没有抖音链接，不回复任何内容
        return res.status(200).send('success');
      }

      try {
        const parsed = await parseDouyin(douyinUrl);
        const replyText = buildFullReply(parsed);
        const replyXml = buildReply(fromUser, toUser, replyText);
        res.setHeader('Content-Type', 'application/xml');
        return res.status(200).send(replyXml);
      } catch (err) {
        console.error('API解析错误:', err);
        // 解析失败也静默处理，不回复错误提示
        return res.status(200).send('success');
      }
    } catch (err) {
      console.error('严重错误:', err);
      return res.status(200).send('success');
    }
  }

  res.status(405).send('Method Not Allowed');
};