// api/wx.js - 从流中读取请求体，绝对可靠
const crypto = require('crypto');

const TOKEN = process.env.WX_TOKEN;
const API_URL = 'http://api.hzv5.cn/dysp.php';

// 从请求流中读取原始数据（解决 Vercel 中 req.body 为空的问题）
function getRawBodyFromReq(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
    });
    req.on('end', () => {
      resolve(data);
    });
    req.on('error', err => {
      reject(err);
    });
  });
}

function checkSignature(signature, timestamp, nonce) {
  const arr = [TOKEN, timestamp, nonce].sort();
  const sha1 = crypto.createHash('sha1').update(arr.join('')).digest('hex');
  return sha1 === signature;
}

// 简单的字符串提取（不使用正则，避免各种匹配问题）
function extractTag(xml, tag) {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  let start = xml.indexOf(open);
  if (start === -1) {
    // 尝试带 CDATA 的格式：<tag><![CDATA[ ... ]]></tag>
    const cdataOpen = `<${tag}>`;
    start = xml.indexOf(cdataOpen);
    if (start === -1) return '';
    const cdataStart = xml.indexOf('<![CDATA[', start);
    if (cdataStart === -1) return '';
    const cdataEnd = xml.indexOf(']]>', cdataStart);
    if (cdataEnd === -1) return '';
    return xml.substring(cdataStart + 9, cdataEnd);
  }
  const end = xml.indexOf(close, start);
  if (end === -1) return '';
  let content = xml.substring(start + open.length, end);
  // 如果内容被 CDATA 包裹，提取实际内容
  if (content.trim().startsWith('<![CDATA[')) {
    const inner = content.trim();
    const innerStart = inner.indexOf('<![CDATA[') + 9;
    const innerEnd = inner.indexOf(']]>', innerStart);
    if (innerEnd !== -1) {
      return inner.substring(innerStart, innerEnd);
    }
  }
  return content.trim();
}

function extractDouyinLink(text) {
  if (!text) return null;
  const regex = /https?:\/\/(v\.douyin\.com|iesdouyin\.com)\/[a-zA-Z0-9_]+\/?/;
  const match = text.match(regex);
  return match ? match[0] : null;
}

async function parseDouyin(shareUrl) {
  const url = `${API_URL}?url=${encodeURIComponent(shareUrl)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.code !== 200) throw new Error(data.msg || '解析失败');
  return data.data;
}

function formatResult(data) {
  const type = data.type;
  const author = data.author || '未知';
  const title = data.title || '无标题';
  const like = data.like || 0;
  let reply = `📱 作者：${author}\n📝 标题：${title}\n❤️ 点赞：${like}\n`;
  if (type === '视频') {
    reply += `🎬 类型：视频\n⏱️ 时长：${Math.floor(data.duration / 1000)}秒\n🔗 视频地址：${data.url}`;
  } else if (type === '图文') {
    const urls = data.url;
    const num = data.num || (urls ? urls.length : 0);
    reply += `🖼️ 类型：图文集\n📸 图片数量：${num}\n`;
    if (urls && urls.length) {
      reply += `\n图片链接（前3张）：\n${urls.slice(0, 3).join('\n')}`;
      if (urls.length > 3) reply += `\n... 共${urls.length}张`;
    }
  } else {
    reply += `⚠️ 未知类型，原始数据：${JSON.stringify(data).substring(0, 200)}`;
  }
  return reply;
}

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
  // GET 验证
  if (req.method === 'GET') {
    const { signature, timestamp, nonce, echostr } = req.query;
    if (checkSignature(signature, timestamp, nonce)) {
      return res.status(200).send(echostr);
    }
    return res.status(401).send('Invalid signature');
  }

  // POST 处理
  if (req.method === 'POST') {
    try {
      // 关键：从流中读取原始请求体（保证获取完整 XML）
      const rawXml = await getRawBodyFromReq(req);
      console.log('rawXml 长度:', rawXml.length);
      
      // 提取用户和内容
      const fromUser = extractTag(rawXml, 'FromUserName');
      const toUser = extractTag(rawXml, 'ToUserName');
      let content = extractTag(rawXml, 'Content');
      const msgType = extractTag(rawXml, 'MsgType');
      
      console.log(`提取: from=${fromUser}, msgType=${msgType}, content=${content}`);
      
      // 如果没有提取到内容，回复原始 XML 用于调试
      if (!content) {
        const snippet = rawXml.substring(0, 800);
        const debugMsg = `【调试】未提取到 Content。原始XML前800字符:\n${snippet}`;
        const replyXml = buildReply(toUser || 'unknown', fromUser || 'unknown', debugMsg);
        res.setHeader('Content-Type', 'application/xml');
        return res.status(200).send(replyXml);
      }
      
      // 正常业务逻辑
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
      // 返回空 success 避免微信重试
      return res.status(200).send('success');
    }
  }
  
  res.status(405).send('Method Not Allowed');
};