// api/wx.js - 临时调试版（回复原始 XML）
const crypto = require('crypto');

const TOKEN = process.env.WX_TOKEN;

function checkSignature(signature, timestamp, nonce) {
  const arr = [TOKEN, timestamp, nonce].sort();
  const sha1 = crypto.createHash('sha1').update(arr.join('')).digest('hex');
  return sha1 === signature;
}

function getRequestBody(req) {
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf-8');
  return '';
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

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    const { signature, timestamp, nonce, echostr } = req.query;
    if (checkSignature(signature, timestamp, nonce)) {
      return res.status(200).send(echostr);
    } else {
      return res.status(401).send('Invalid signature');
    }
  }

  if (req.method === 'POST') {
    try {
      // 获取原始请求体（XML 字符串）
      const rawBody = getRequestBody(req);
      
      // 简单提取 FromUserName 和 ToUserName（用于回复）
      const fromUserMatch = rawBody.match(/<FromUserName><!\[CDATA\[(.*?)\]\]><\/FromUserName>/);
      const toUserMatch = rawBody.match(/<ToUserName><!\[CDATA\[(.*?)\]\]><\/ToUserName>/);
      const fromUser = fromUserMatch ? fromUserMatch[1] : 'unknown';
      const toUser = toUserMatch ? toUserMatch[1] : 'unknown';
      
      // 回复内容：原始 XML 的前 1000 个字符
      const replyText = `【调试】收到原始XML（前1000字符）:\n\n${rawBody.substring(0, 1000)}`;
      const replyXml = buildReplyXML(fromUser, toUser, replyText);
      
      res.setHeader('Content-Type', 'application/xml');
      return res.status(200).send(replyXml);
    } catch (err) {
      console.error('调试异常:', err);
      return res.status(200).send('success');
    }
  }

  return res.status(405).send('Method Not Allowed');
};