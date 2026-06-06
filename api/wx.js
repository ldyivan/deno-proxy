// api/wx.js - 调试增强版（无文本内容时返回原始XML片段）
const crypto = require('crypto');

const TOKEN = process.env.WX_TOKEN;
const API_URL = 'http://api.hzv5.cn/dysp.php';

function checkSignature(signature, timestamp, nonce) {
  const arr = [TOKEN, timestamp, nonce].sort();
  const sha1 = crypto.createHash('sha1').update(arr.join('')).digest('hex');
  return sha1 === signature;
}

function getRawBody(req) {
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf-8');
  return '';
}

function extractFromXML(xml, tag) {
  const cdataPattern = new RegExp(`<${tag}>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`);
  let match = xml.match(cdataPattern);
  if (match) return match[1];
  const textPattern = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`);
  match = xml.match(textPattern);
  return match ? match[1].trim() : '';
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
  if (req.method === 'GET') {
    const { signature, timestamp, nonce, echostr } = req.query;
    if (checkSignature(signature, timestamp, nonce)) {
      return res.status(200).send(echostr);
    }
    return res.status(401).send('Invalid signature');
  }

  if (req.method === 'POST') {
    try {
      const rawXml = getRawBody(req);
      const fromUser = extractFromXML(rawXml, 'FromUserName');
      const toUser = extractFromXML(rawXml, 'ToUserName');
      const content = extractFromXML(rawXml, 'Content');
      const msgType = extractFromXML(rawXml, 'MsgType');

      console.log(`[调试] from=${fromUser}, msgType=${msgType}, content长度=${content ? content.length : 0}`);

      // 如果没有提取到内容，则回复原始 XML 的前 500 个字符（调试用）
      if (!content) {
        const snippet = rawXml.substring(0, 500);
        const debugReply = `【调试】未提取到文本内容。原始XML前500字符：\n\n${snippet}`;
        const replyXml = buildReply(fromUser || 'unknown', toUser || 'unknown', debugReply);
        res.setHeader('Content-Type', 'application/xml');
        return res.status(200).send(replyXml);
      }

      // 正常处理：提取抖音链接
      const douyinUrl = extractDouyinLink(content);
      let replyText = '';
      if (!douyinUrl) {
        replyText = '请发送抖音分享链接，例如：https://v.douyin.com/xxxxx/';
      } else {
        try {
          const parsed = await parseDouyin(douyinUrl);
          replyText = formatResult(parsed);
        } catch (err) {
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