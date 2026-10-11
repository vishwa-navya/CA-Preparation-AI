import { uploadImageToSupabase } from './supabase';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export async function schedulePhotoMessage(
  file: File,
  senderNickname: 'Ammu' | 'Vishwa',
  localDateTime: string,
): Promise<void> {
  const scheduledDate = new Date(localDateTime);
  if (!Number.isFinite(scheduledDate.getTime()) || scheduledDate.getTime() <= Date.now()) {
    throw new Error('Choose a future date and time.');
  }

  const fileName = `${senderNickname}_${Date.now()}_${file.name || 'photo.jpg'}`;
  const photoUrl = await uploadImageToSupabase(file, fileName);
  const response = await fetch(`${supabaseUrl}/functions/v1/schedule-photo`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${supabaseAnonKey}`,
      apikey: supabaseAnonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      senderNickname,
      recipientNickname: senderNickname === 'Ammu' ? 'Vishwa' : 'Ammu',
      conversationName: 'privateMessages',
      photoUrl,
      fileName,
      scheduledFor: scheduledDate.toISOString(),
    }),
  });

  const body = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) {
    throw new Error(body?.error || 'Unable to schedule this photo.');
  }
}
