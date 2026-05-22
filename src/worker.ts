export default {
  fetch() {
    return new Response('Instacomic static assets are served by Cloudflare Workers.', {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
  },
}
