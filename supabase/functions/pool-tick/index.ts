const appUrl = Deno.env.get('POOL_APP_URL')?.replace(/\/$/, '');
const adminKey = Deno.env.get('POOL_ADMIN_KEY');

Deno.serve(async () => {
  if (!appUrl || !adminKey) {
    return Response.json({ error: 'POOL_APP_URL and POOL_ADMIN_KEY are required' }, { status: 500 });
  }
  const response = await fetch(`${appUrl}/api/admin/scheduler-tick`, {
    method: 'POST',
    headers: { 'x-admin-key': adminKey, 'content-type': 'application/json' },
    body: '{}'
  });
  const text = await response.text();
  return new Response(text, { status: response.status, headers: { 'content-type': 'application/json' } });
});
