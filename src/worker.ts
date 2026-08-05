interface Env {
  ASSETS: {
    fetch(request: Request): Promise<Response>
  }
}

export default {
  async fetch(request: Request, env: Env) {
    const response = await env.ASSETS.fetch(request)
    const contentType = response.headers.get('content-type') ?? ''
    if (request.method !== 'GET' || !contentType.includes('text/html')) {
      return response
    }

    const headers = new Headers(response.headers)
    headers.set('cache-control', 'no-cache, no-store, must-revalidate')
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  },
}
