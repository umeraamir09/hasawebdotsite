export default {
  fetch(request) {
    const url = new URL(request.url);
    if (url.host !== "www.hasaweb.site")
      return new Response(null, { status: 421 });
    url.protocol = "https:";
    url.hostname = "hasaweb.site";
    return Response.redirect(url.href, 308);
  },
} satisfies ExportedHandler;
