const crypto = require('crypto');

const TOKEN = process.env.WX_TOKEN;
const API_URL = 'http://api.hzv5.cn/dysp.php';

function getRawBodyFromReq(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => { resolve(data); });
    req.on('error', reject);
  });
}

function checkSignature(signature, timestamp, nonce) {
  const arr = [TOKEN, timestamp, nonce].sort();
  const sha1 = crypto.createHash('sha1').update(arr.join('')).digest('hex');
  return sha1 === signature;
}

function extractTag(xml, tag) {
  const cdataRegex = new RegExp(`<${tag}><\\!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`);
  let match = xml.match(cdataRegex);
  if (match) return match[1];
  const textRegex = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`);
  match = xml.match(textRegex);
  return match ? match[1].trim() : '';
}

// 修正：支持短横线
function extractDouyinLink(text) {
  if (!text) return null;
  const regex = /https?:\/\/(v\.douyin\.com|iesdouyin\.com)\/[a-zA-Z0-9_-]+\/?/;
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

function extractImageUrls(urlField) {
  if (!urlField) return [];
  if (Array.isArray(urlField)) return urlField;
  if (typeof urlField === 'object') return Object.values(urlField);
  return [urlField];
}

// 缩短标题
function shortenTitle(title, maxLen = 10) {
  if (!title) return '无标题';
  if (title.length <= maxLen) return title;
  return title.substring(0, maxLen) + '...';
}

function formatResult(data) {
  const type = data.type; // "视频" 或 "图文"
  const author = data.author || '未知';
  const title = shortenTitle(data.title);
  const like = data.like || 0;

  let lines = [
    `${author} | ${title} | ❤️${like}`
  ];

  if (type === '视频') {
    const videoUrl = data.url;
    lines.push(`<a href="${videoUrl}">观看视频</a>`);
  } 
  else if (type === '图文') {
    const urls = extractImageUrls(data.url);
    const num = data.num || urls.length;
    lines.push(`共${num}张`);
    urls.forEach((url, idx) => {
      lines.push(`<a href="${url}">图${idx+1}</a>`);
    });
  } 
  else {
    lines.push(`未知类型：${JSON.stringify(data).substring(0, 100)}`);
  }

  return lines.join('\n');
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
        replyText = ''; //'请发送抖音分享链接，例如：https://v.douyin.com/xxxxx/';
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