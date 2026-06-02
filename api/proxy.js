// api/proxy.js - Vercel Node.js 流式代理
export default async function handler(req, res) {
    const { searchParams } = new URL(req.url, 'http://n');
    let targetUrl = searchParams.get('target') || searchParams.get('url');
    if (!targetUrl) {
        return res.status(400).send('Missing target');
    }
    try {
        const response = await fetch(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Referer': 'https://www.doubao.com/',
            },
        });
        if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
        // 关键：流式返回
        res.setHeader('Content-Type', response.headers.get('content-type') || 'video/mp4');
        res.setHeader('Access-Control-Allow-Origin', '*');
        const reader = response.body.getReader();
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(Buffer.from(value));
        }
        res.end();
    } catch (err) {
        res.status(500).send(`Proxy error: ${err.message}`);
    }
}
