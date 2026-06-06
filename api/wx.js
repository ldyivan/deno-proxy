// api/wx.js
// 微信公众号 + 抖音视频/图集解析（修复版）

const crypto = require('crypto');

// 从环境变量读取微信 Token
const TOKEN = process.env.WX_TOKEN;

// 抖音解析 API 地址
const API_URL = 'http://api.hzv5.cn/dysp.php';

// ========== 1. 微信验证 ==========
function checkSignature(signature, timestamp, nonce) {
  const arr = [TOKEN, timestamp, nonce].sort();
  const sha1 = crypto.createHash('sha1').update(arr.join('')).digest('hex');
  return sha1 === signature;
}

// ========== 2. 安全的 XML 解析（兼容 Buffer 和 CDATA） ==========
function getRequestBody(req) {
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf-8');
  if (req.body && typeof req.body === 'object') {
    // 极少数情况下 Vercel 可能解析成对象，但微信是 XML，通常不会
    return JSON.stringify(req.body);
  }
  return '';
}

function parseXML(xmlStr) {
  const str = xmlStr || '';
  // 通用标签提取（支持 CDATA 和普通文本，支持换行）
  function getTag(tag) {
    // 匹配 CDATA: <tag><![CDATA[内容]]></tag>
    let match = str.match(new RegExp(`<${tag}>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`));
    if (match) return match[1];
    // 匹配普通文本: <tag>内容</tag>
    match = str.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
    return match ? match[1].trim() : '';
  }
  return {
    fromUser: getTag('FromUserName'),
    toUser: getTag('ToUserName'),
    content: getTag('Content'),
    msgType: getTag('MsgType')
  };
}

// 构造回复 XML
function buildReplyXML(toUser, fromUser, content) {
  const timestamp = Math.floor(Date.now() / 1000);
  return `<xml>
  <ToUserName><![CDATA[${toUser}]]></ToUserName>
  <FromUserName><![CDATA[${fromUser}]]></FromUserName>
  <CreateTime>${timestamp}</CreateTime>
  <MsgType><![CDATA[text]]></MsgType>
  <Content><![CDATA[${content}]]></Content>
</xml>`;
}

// ========== 3. 抖音链接提取 ==========
function extractDouyinLink(text) {
  if (!text || typeof text !== 'string') return null;
  // 匹配常见的抖音分享链接（支持 http/https，v.douyin.com 或 iesdouyin.com）
  const regex = /https?:\/\/(v\.douyin\.com|iesdouyin\.com)\/[a-zA-Z0-9_]+\/?/;
  const match = text.match(regex);
  return match ? match[0] : null;
}

// ========== 4. 调用解析 API ==========
async function parseDouyinLink(shareUrl) {
  const url = `${API_URL}?url=${encodeURIComponent(shareUrl)}`;
  console.log(`[API] 请求: ${url}`);
  
  const response = await fetch(url, {
    method: 'GET',
    headers: { 'User-Agent': 'Mozilla/5.0' },
    timeout: 8000  // 8秒超时（Vercel 最大10秒，留2秒余量）
  });
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  
  const data = await response.json();
  console.log(`[API] 返回: code=${data.code}`);
  
  if (data.code !== 200) {
    throw new Error(data.msg || '解析失败');
  }
  return data.data;
}

// 格式化回复内容
function formatReply(data) {
  const type = data.type;        // "视频" 或 "图文"
  const author = data.author || '未知';
  const title = data.title || '无标题';
  const like = data.like || 0;
  
  let lines = [
    `📱 作者：${author}`,
    `📝 标题：${title}`,
    `❤️ 点赞：${like}`
  ];
  
  if (type === '视频') {
    const duration = data.duration ? `${Math.floor(data.duration / 1000)}秒` : '未知';
    const videoUrl = data.url;
    lines.push(`🎬 类型：视频`);
    lines.push(`⏱️ 时长：${duration}`);
    lines.push(`🔗 视频地址：${videoUrl}`);
  } 
  else if (type === '图文') {
    const urls = data.url;      // 图片链接数组
    const num = data.num || (urls ? urls.length : 0);
    lines.push(`🖼️ 类型：图文集`);
    lines.push(`📸 图片数量：${num}`);
    if (urls && urls.length > 0) {
      const preview = urls.slice(0, 3).join('\n');
      lines.push(`\n图片链接（前3张）：\n${preview}`);
      if (urls.length > 3) lines.push(`... 共${urls.length}张`);
    }
  } 
  else {
    lines.push(`⚠️ 未知类型，原始数据：${JSON.stringify(data).substring(0, 200)}`);
  }
  
  return lines.join('\n');
}

// ========== 5. 主函数 ==========
module.exports = async (req, res) => {
  // GET：微信验证服务器
  if (req.method === 'GET') {
    const { signature, timestamp, nonce, echostr } = req.query;
    if (checkSignature(signature, timestamp, nonce)) {
      console.log('[验证] 成功，返回 echostr');
      return res.status(200).send(echostr);
    } else {
      console.log('[验证] 签名失败');
      return res.status(401).send('Invalid signature');
    }
  }
  
  // POST：接收用户消息
  if (req.method === 'POST') {
    try {
      // 1. 获取原始请求体（解决 Buffer 问题）
      const rawBody = getRequestBody(req);
      console.log(`[消息] 原始长度: ${rawBody.length}, 前200字符: ${rawBody.substring(0, 200)}`);
      
      // 2. 解析 XML
      const { fromUser, toUser, content, msgType } = parseXML(rawBody);
      console.log(`[消息] 解析结果: from=${fromUser}, msgType=${msgType}, content=${content}`);
      
      // 3. 非文本消息直接忽略
      if (msgType !== 'text') {
        console.log('[消息] 非文本消息，忽略');
        return res.status(200).send('success');
      }
      
      // 4. 提取抖音链接
      const douyinUrl = extractDouyinLink(content);
      let replyText = '';
      
      if (!douyinUrl) {
        replyText = '请发送抖音分享链接，例如：https://v.douyin.com/xxxxx/';
        console.log('[回复] 未检测到链接');
      } else {
        console.log(`[链接] 提取到: ${douyinUrl}`);
        try {
          const parsed = await parseDouyinLink(douyinUrl);
          replyText = formatReply(parsed);
          console.log('[回复] 解析成功，回复长度:', replyText.length);
        } catch (err) {
          console.error('[API] 调用失败:', err);
          replyText = `解析失败：${err.message}\n请检查链接是否正确或稍后再试。`;
        }
      }
      
      // 5. 构造并返回 XML
      const replyXml = buildReplyXML(fromUser, toUser, replyText);
      res.setHeader('Content-Type', 'application/xml');
      return res.status(200).send(replyXml);
      
    } catch (err) {
      console.error('[异常] 全局捕获:', err);
      // 必须返回 success，否则微信会重试
      return res.status(200).send('success');
    }
  }
  
  // 其他方法
  return res.status(405).send('Method Not Allowed');
};