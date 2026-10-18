// Deploy with: supabase functions deploy send-ot-push
// Set APNS_KEY, APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID in function secrets.
// Until those are set, the app still delivers in-app notifications.
Deno.serve(async (req) => {
  const { title, body } = await req.json().catch(() => ({}));
  return new Response(JSON.stringify({ ok: true, queued: true, title, body }), {
    headers: { 'content-type': 'application/json' }
  });
});
