Deno.serve(async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    let targetUrl = url.searchParams.get("target") || url.searchParams.get("url");
    if (!targetUrl) {
        return new Response("Missing 'target' parameter.", { status: 400 });
    }
    try {
        const res = await fetch(targetUrl, {
            headers: {
                "User-Agent": "Mozilla/5.0",
                "Referer": "https://www.doubao.com/"
            }
        });
        return new Response(res.body, {
            status: 200,
            headers: { "Access-Control-Allow-Origin": "*" }
        });
    } catch (err) {
        return new Response(`Proxy error: ${err.message}`, { status: 500 });
    }
});
