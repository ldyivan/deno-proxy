// api/proxy.js
export default async function handler(req, res) {
  const { searchParams } = new URL(req.url, `http://${req.headers.host}`);
  let targetUrl = searchParams.get('target') || searchParams.get('url');

  if (!targetUrl) {
    return res.status(400).send('Missing "target" parameter.');
  }

  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        // 'Referer': 'https://www.doubao.com/',
      },
    });

    if (!response.ok) {
      throw new Error(`Fetch failed: ${response.status}`);
    }

    // 设置正确的响应头
    res.setHeader('Content-Type', response.headers.get('content-type') || 'video/mp4');
    res.setHeader('Access-Control-Allow-Origin', '*');

    // 核心：流式传输
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();

  } catch (err) {
    console.error(err);
    res.status(500).send(`Proxy error: ${err.message}`);
  }
}
