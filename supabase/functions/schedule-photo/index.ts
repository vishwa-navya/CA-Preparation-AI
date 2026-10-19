import { createClient } from "npm:@supabase/supabase-js@2.51.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  try {
    if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const body = await req.json();
    const sender = body.senderNickname;
    const recipient = body.recipientNickname;
    const scheduledFor = new Date(body.scheduledFor);
    const photoUrl = String(body.photoUrl ?? "");
    const fileName = String(body.fileName ?? "");
    if (!['Ammu', 'Vishwa'].includes(sender) || !['Ammu', 'Vishwa'].includes(recipient) || sender === recipient) throw new Error("Invalid participants");
    if (!Number.isFinite(scheduledFor.getTime()) || scheduledFor.getTime() <= Date.now()) throw new Error("Choose a future date and time");
    if (!photoUrl.startsWith(`${supabaseUrl}/storage/v1/object/public/chat-images/`)) throw new Error("Invalid photo location");
    if (!fileName || fileName.length > 240) throw new Error("Invalid photo name");
    const { error } = await admin.from("scheduled_photo_messages").insert({ sender_nickname: sender, recipient_nickname: recipient, conversation_name: "privateMessages", photo_url: photoUrl, file_name: fileName, scheduled_for: scheduledFor.toISOString() });
    if (error) throw error;
    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("schedule-photo failed", error);
    return new Response(JSON.stringify({ error: "Unable to schedule this photo" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
