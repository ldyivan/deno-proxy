const crypto = require('crypto');

const TOKEN = process.env.WX_TOKEN;
const API_URL = 'http://api.hzv5.cn/dysp.php';
const MAX_BYTES = 2000;        // 微信文本消息建议不超过 2048，留 48 字节安全余量

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

// 支持短横线的抖音链接正则
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

function shortenTitle(title, maxLen = 15) {
  if (!title) return '无标题';
  if (title.length <= maxLen) return title;
  return title.substring(0, maxLen) + '…';
}

// 生成基础头部（作者、标题、点赞）
function buildHeader(data) {
  const author = data.author || '未知';
  const title = shortenTitle(data.title);
  const like = data.like || 0;
  return `${author} | ${title} | ❤️${like}`;
}

// 生成完整回复文本，支持动态减少图片数量
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

  // 图文集
  const allUrls = extractImageUrls(data.url);
  const totalNum = data.num || allUrls.length;
  lines.push(`📷 共${totalNum}张图`);

  // 尝试加入所有图片，若超长则逐步减少
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
      // 符合要求，使用这个版本
      replyText = testText;
      break;
    } else {
      // 移除最后一张图（如果只剩一张图还超长，则强制保留一张）
      if (currentUrls.length === 1) {
        // 保留一张，即使超长也认了（一般不会超）
        replyText = testText;
        break;
      }
      currentUrls.pop();
    }
  }

  // 如果因数量减少而未显示全部，添加说明
  if (replyText && currentUrls.length < allUrls.length) {
    replyText += `\n(仅显示前${currentUrls.length}张，共${totalNum}张)`;
  }

  return replyText || (lines.join('\n') + '\n(无法生成回复)');
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
        replyText = '请发送抖音分享链接，例如：https://v.douyin.com/xxxxx/';
      } else {
        try {
          const parsed = await parseDouyin(douyinUrl);
          replyText = buildFullReply(parsed);
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