// api/wx.js
// 微信公众号 + 抖音视频/图集解析示例

const crypto = require('crypto');

// 微信 Token（从环境变量读取）
const TOKEN = process.env.WX_TOKEN;

// 抖音解析 API 地址
const API_URL = 'http://api.hzv5.cn/dysp.php';

// -------------------- 微信验证 --------------------
function checkSignature(signature, timestamp, nonce) {
  const arr = [TOKEN, timestamp, nonce].sort();
  const sha1 = crypto.createHash('sha1').update(arr.join('')).digest('hex');
  return sha1 === signature;
}

// -------------------- XML 解析（简易版） --------------------
function parseXML(xml) {
  const getTag = (tag) => {
    const match = xml.match(new RegExp(`<${tag}><!\\[CDATA\\[(.*?)\\]\\]></${tag}>`));
    return match ? match[1] : '';
  };
  return {
    fromUser: getTag('FromUserName'),
    toUser: getTag('ToUserName'),
    content: getTag('Content'),
    msgType: getTag('MsgType')
  };
}

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

// -------------------- 抖音解析 --------------------
// 从文本中提取抖音分享链接
function extractDouyinLink(text) {
  // 匹配常见的抖音分享链接：https://v.douyin.com/xxxxx/ 或 http://...
  const regex = /https?:\/\/v\.douyin\.com\/[a-zA-Z0-9_]+\/?/;
  const match = text.match(regex);
  return match ? match[0] : null;
}

// 调用解析 API
async function parseDouyinLink(shareUrl) {
  const url = `${API_URL}?url=${encodeURIComponent(shareUrl)}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  if (!response.ok) {
    throw new Error(`API 请求失败: ${response.status}`);
  }
  const data = await response.json();
  if (data.code !== 200) {
    throw new Error(data.msg || '解析失败');
  }
  return data.data;
}

// 格式化回复消息
function formatReply(data) {
  const type = data.type; // "视频" 或 "图文"
  const author = data.author || '未知';
  const title = data.title || '无标题';
  const like = data.like || 0;
  
  let content = `📱 作者：${author}\n📝 标题：${title}\n❤️ 点赞：${like}\n`;
  
  if (type === '视频') {
    const duration = data.duration ? `${Math.floor(data.duration / 1000)}秒` : '未知';
    const videoUrl = data.url;
    content += `🎬 类型：视频\n⏱️ 时长：${duration}\n🔗 视频地址：${videoUrl}`;
  } else if (type === '图文') {
    const urls = data.url; // 图片链接数组
    const num = data.num || urls.length;
    content += `🖼️ 类型：图文集\n📸 图片数量：${num}\n`;
    if (urls && urls.length > 0) {
      content += `\n图片链接（前3张）：\n${urls.slice(0, 3).join('\n')}`;
      if (urls.length > 3) content += `\n... 共${urls.length}张`;
    }
  } else {
    content += `⚠️ 未知类型，原始数据：${JSON.stringify(data)}`;
  }
  
  return content;
}

// -------------------- Vercel 主函数 --------------------
module.exports = async (req, res) => {
  // 微信验证 URL（GET 请求）
  if (req.method === 'GET') {
    const { signature, timestamp, nonce, echostr } = req.query;
    if (checkSignature(signature, timestamp, nonce)) {
      return res.status(200).send(echostr);
    } else {
      return res.status(401).send('Invalid signature');
    }
  }
  
  // 接收用户消息（POST）
  if (req.method === 'POST') {
    try {
      const body = req.body;
      const { fromUser, toUser, content, msgType } = parseXML(body);
      
      // 只处理文本消息
      if (msgType !== 'text') {
        return res.status(200).send('success');
      }
      
      // 提取抖音链接
      const douyinUrl = extractDouyinLink(content);
      let replyText = '';
      
      if (!douyinUrl) {
        replyText = '请发送抖音分享链接，例如：https://v.douyin.com/xxxxx/';
      } else {
        try {
          const parsed = await parseDouyinLink(douyinUrl);
          replyText = formatReply(parsed);
        } catch (err) {
          console.error('解析失败:', err);
          replyText = `解析失败：${err.message}\n请检查链接是否正确或稍后再试。`;
        }
      }
      
      const replyXml = buildReplyXML(fromUser, toUser, replyText);
      res.setHeader('Content-Type', 'application/xml');
      return res.status(200).send(replyXml);
      
    } catch (err) {
      console.error('处理消息异常:', err);
      // 必须返回 200，否则微信会重试
      return res.status(200).send('success');
    }
  }
  
  return res.status(405).send('Method Not Allowed');
};