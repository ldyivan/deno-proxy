// api/create-menu.js - 通过浏览器访问创建自定义菜单
const fetch = require('node-fetch');

const APPID = process.env.WX_APPID;
const APPSECRET = process.env.WX_APPSECRET;
const SECRET_KEY = process.env.MENU_SECRET;

async function getAccessToken() {
  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${APPID}&secret=${APPSECRET}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`获取access_token失败: ${data.errmsg}`);
  }
  return data.access_token;
}

async function createMenu(accessToken) {
  // 菜单结构（请根据需求修改）
  // api/create-menu.js
// ... (获取 access_token 的代码保持不变) ...

async function createMenu(accessToken) {
    const menu = {
        button: [
            {
                "name": "帮助中心",
                "sub_button": [
                    {
                        "type": "click",
                        "name": "使用帮助",
                        "key": "help_usage"
                    },
                    {
                        "type": "click",
                        "name": "关于我们",
                        "key": "help_about"
                    }
                ]
            },
            {
                "type": "view",
                "name": "官网",
                "url": "https://weixin.qq.com"
            }
        ]
    };
    // ... (发送POST请求的代码保持不变) ...
  };
  const url = `https://api.weixin.qq.com/cgi-bin/menu/create?access_token=${accessToken}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(menu)
  });
  return await res.json();
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).send('Method Not Allowed');
  }

  const { secret } = req.query;
  if (!SECRET_KEY || secret !== SECRET_KEY) {
    return res.status(401).send('Unauthorized: 请提供正确的 secret 参数');
  }

  try {
    const token = await getAccessToken();
    const result = await createMenu(token);
    if (result.errcode === 0) {
      res.status(200).json({ success: true, message: '菜单创建成功', result });
    } else {
      res.status(200).json({ success: false, message: '菜单创建失败', result });
    }
  } catch (err) {
    console.error('创建菜单异常:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};