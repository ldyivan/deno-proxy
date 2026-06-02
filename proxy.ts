Deno.serve(async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    let targetUrl = url.searchParams.get("target") || url.searchParams.get("url");
    if (!targetUrl) {
        return new Response("Missing 'target' parameter.", { status: 400 });
    }

    try {
        // 1. 添加超时控制，避免长时间等待
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); // 15秒超时

        const res = await fetch(targetUrl, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Accept": "*/*",
                "Accept-Encoding": "gzip, deflate, br",
                "Connection": "keep-alive"
            },
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!res.ok) {
            return new Response(`源站错误: ${res.status}`, { status: 502 });
        }

        // 2. 正确设置 Content-Type
        let contentType = res.headers.get("content-type") || "video/mp4";
        if (targetUrl.match(/\.(mp4|m4v|mov|avi|flv)$/i) && !contentType.includes("video")) {
            contentType = "video/mp4";
        }

        // 3. 添加缓存头，让 CDN 缓存（第二次请求会快很多）
        const cacheControl = "public, max-age=86400, stale-while-revalidate=86400";

        // 4. 流式返回
        return new Response(res.body, {
            status: 200,
            headers: {
                "Content-Type": contentType,
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": cacheControl,
                "CDN-Cache-Control": cacheControl,
                "Vary": "Accept-Encoding"
            }
        });
    } catch (err) {
        console.error("Proxy error:", err.message);
        return new Response(`代理错误: ${err.message}`, { status: 500 });
    }
});
