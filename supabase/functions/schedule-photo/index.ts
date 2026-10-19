import { createClient } from "npm:@supabase/supabase-js@2.51.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Errors we raise on purpose carry a message that is safe and useful to show the user.
class UserError extends Error {}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const body = await req.json().catch(() => null);
    if (!body) throw new UserError("Invalid request");

    const sender = body.senderNickname;
    const recipient = body.recipientNickname;
    const scheduledFor = new Date(body.scheduledFor);
    const photoUrl = String(body.photoUrl ?? "");
    const fileName = String(body.fileName ?? "");

    if (!["Ammu", "Vishwa"].includes(sender) || !["Ammu", "Vishwa"].includes(recipient) || sender === recipient) {
      throw new UserError("Invalid participants");
    }
    if (!Number.isFinite(scheduledFor.getTime()) || scheduledFor.getTime() <= Date.now()) {
      throw new UserError("Choose a future date and time");
    }
    if (!photoUrl.startsWith(`${supabaseUrl}/storage/v1/object/public/chat-images/`)) {
      // Happens when the photo was uploaded to a different Supabase project than this function runs in.
      throw new UserError("Photo was uploaded to a different Supabase project than the scheduler. Make sure the app and the functions use the same project.");
    }
    if (!fileName || fileName.length > 240) throw new UserError("Invalid photo name");

    const { error } = await admin.from("scheduled_photo_messages").insert({
      sender_nickname: sender,
      recipient_nickname: recipient,
      conversation_name: "privateMessages",
      photo_url: photoUrl,
      file_name: fileName,
      scheduled_for: scheduledFor.toISOString(),
    });
    if (error) {
      console.error("schedule-photo insert failed", error);
      const hint = String(error.message ?? "").slice(0, 160);
      throw new UserError(`Could not save the schedule: ${hint}`);
    }

    return json({ success: true });
  } catch (error) {
    console.error("schedule-photo failed", error);
    if (error instanceof UserError) return json({ error: error.message }, 400);
    return json({ error: "Unable to schedule this photo" }, 500);
  }
});