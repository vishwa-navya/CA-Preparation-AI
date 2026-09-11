-- Create the chat-images storage bucket (used for images, videos, and files)
INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-images', 'chat-images', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public read access to chat-images
CREATE POLICY "Allow public downloads from chat-images"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'chat-images');

-- Allow authenticated uploads to chat-images
CREATE POLICY "Allow authenticated uploads to chat-images"
  ON storage.objects FOR INSERT
  TO anon, authenticated
  WITH CHECK (bucket_id = 'chat-images');

-- Allow authenticated updates to chat-images (for upsert)
CREATE POLICY "Allow authenticated updates to chat-images"
  ON storage.objects FOR UPDATE
  TO anon, authenticated
  USING (bucket_id = 'chat-images')
  WITH CHECK (bucket_id = 'chat-images');

-- Allow authenticated deletes from chat-images
CREATE POLICY "Allow authenticated deletes from chat-images"
  ON storage.objects FOR DELETE
  TO anon, authenticated
  USING (bucket_id = 'chat-images');
