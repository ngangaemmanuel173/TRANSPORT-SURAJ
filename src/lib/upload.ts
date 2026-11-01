import { supabase } from '@/lib/supabase';

export async function uploadDocument(
  file: File,
  folder: string,
  recordId: string
): Promise<{ url: string | null; error: string | null }> {
  const timestamp = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${folder}/${recordId}/${timestamp}_${safeName}`;

  const { data, error } = await supabase.storage
    .from('documents')
    .upload(path, file, {
      cacheControl: '3600',
      upsert: false,
    });

  if (error) {
    console.error('[Upload Error]', error.message);
    return { url: null, error: error.message };
  }

  const { data: urlData } = supabase.storage
    .from('documents')
    .getPublicUrl(data.path);

  return { url: urlData.publicUrl, error: null };
}

export async function deleteDocument(
  url: string
): Promise<{ error: string | null }> {
  const parts = url.split('/storage/v1/object/public/documents/');
  if (parts.length < 2) return { error: 'Invalid URL' };

  const { error } = await supabase.storage
    .from('documents')
    .remove([parts[1]]);

  if (error) {
    console.error('[Delete Error]', error.message);
    return { error: error.message };
  }
  return { error: null };
}

export function getFileName(url: string): string {
  const parts = url.split('/');
  const raw = parts[parts.length - 1];
  return raw.replace(/^\d+_/, '');
}