import { uploadImageToSupabase, supabaseUrl, supabaseAnonKey } from './supabase';

// IMPORTANT: the Supabase URL and key come from supabase.ts (the same project the
// photo upload uses). Do NOT read import.meta.env.VITE_SUPABASE_* here — if that
// points at a different project than the upload, scheduling fails.

function describeHttpFailure(status: number, serverMessage?: string): string {
  if (status === 404) {
    return 'Scheduling service not found. Deploy the "schedule-photo" Edge Function on this Supabase project.';
  }
  if (status === 401 || status === 403) {
    return 'Scheduling service rejected the request. Turn "Verify JWT" OFF for schedule-photo and check the anon key.';
  }
  if (serverMessage) return serverMessage;
  return `Unable to schedule this photo (error ${status}).`;
}

export async function schedulePhotoMessage(
  file: File,
  senderNickname: 'Ammu' | 'Vishwa',
  localDateTime: string,
): Promise<void> {
  const scheduledDate = new Date(localDateTime);
  if (!Number.isFinite(scheduledDate.getTime()) || scheduledDate.getTime() <= Date.now()) {
    throw new Error('Choose a future date and time.');
  }

  // 1) Upload the photo to the chat-images bucket.
  const fileName = `${senderNickname}_${Date.now()}_${file.name || 'photo.jpg'}`;
  let photoUrl: string;
  try {
    photoUrl = await uploadImageToSupabase(file, fileName);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown error';
    throw new Error(`Photo upload failed: ${reason}`);
  }

  // 2) Save the schedule on the server so it is sent even when both users are offline.
  let response: Response;
  try {
    response = await fetch(`${supabaseUrl}/functions/v1/schedule-photo`, {
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
  } catch (error) {
    console.error('schedule-photo network error:', error);
    throw new Error('Could not reach the scheduling service. Check your internet connection and try again.');
  }

  const body = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) {
    console.error('schedule-photo failed:', response.status, body);
    throw new Error(describeHttpFailure(response.status, body?.error));
  }

  // Try to deliver right away in case the time is only seconds away.
  void triggerScheduledPhotoDelivery();
}

/**
 * Asks the deliver-scheduled-photos Edge Function to send every photo that is
 * due. Safe to call often: it only touches rows whose time has arrived and each
 * photo is written to the chat exactly once.
 */
export async function triggerScheduledPhotoDelivery(): Promise<void> {
  if (!supabaseUrl || !supabaseAnonKey) return;
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/deliver-scheduled-photos`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${supabaseAnonKey}`,
        apikey: supabaseAnonKey,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    if (!response.ok) {
      console.warn('Scheduled photo delivery check failed:', response.status);
      return;
    }
    const result = await response.json().catch(() => null) as { claimed?: number; delivered?: number } | null;
    if (result?.claimed) {
      console.log('📷 Scheduled photos processed:', result);
    }
  } catch (error) {
    console.warn('Scheduled photo delivery check error:', error);
  }
}