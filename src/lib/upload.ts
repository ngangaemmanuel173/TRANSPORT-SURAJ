import { supabase, getSubAccountFilter } from '@/lib/supabase';

const BUCKET = 'documents';

// Rows saved before the bucket was made private hold a full public URL; new rows hold the bare storage path.
const PUBLIC_MARKER = `/storage/v1/object/public/${BUCKET}/`;

/** Storage path for a stored document value (old public URL or new bare path). null = not one of ours. */
export function documentPath(value: string): string | null {
  if (!value) return null;
  const i = value.indexOf(PUBLIC_MARKER);
  if (i >= 0) {
    try { return decodeURIComponent(value.slice(i + PUBLIC_MARKER.length).split('?')[0]); }
    catch { return value.slice(i + PUBLIC_MARKER.length).split('?')[0]; }
  }
  if (/^https?:\/\//i.test(value)) return null;
  return value;
}

/**
 * Uploads to the private "documents" bucket under <sub_account>/<folder>/<record>/<file>.
 * The database only lets a user touch files under a sub-account they have access to.
 * `url` in the result is the storage path (store this in the record's documents array).
 */
export async function uploadDocument(
  file: File,
  folder: string,
  recordId: string
): Promise<{ url: string | null; error: string | null }> {
  const timestamp = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const sub = getSubAccountFilter() || 'master';
  const path = `${sub}/${folder}/${recordId}/${timestamp}_${safeName}`;

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, {
      cacheControl: '3600',
      upsert: false,
    });

  if (error) {
    console.error('[Upload Error]', error.message);
    return { url: null, error: error.message };
  }

  return { url: data.path, error: null };
}

/** Short-lived link to open a stored document (the bucket is private, so plain links do not work). */
export async function getDocumentLink(
  value: string,
  expiresInSeconds = 600
): Promise<{ url: string | null; error: string | null }> {
  const path = documentPath(value);
  if (!path) {
    // Not a file in our bucket: an external link someone pasted in. Open it as it is.
    return /^https?:\/\//i.test(value) ? { url: value, error: null } : { url: null, error: 'Invalid document reference' };
  }

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, expiresInSeconds);

  if (error || !data?.signedUrl) {
    console.error('[Signed URL Error]', error?.message);
    return { url: null, error: error?.message || 'Could not open this document' };
  }
  return { url: data.signedUrl, error: null };
}

export async function deleteDocument(
  value: string
): Promise<{ error: string | null }> {
  const path = documentPath(value);
  if (!path) return { error: 'Invalid URL' };

  const { error } = await supabase.storage
    .from(BUCKET)
    .remove([path]);

  if (error) {
    console.error('[Delete Error]', error.message);
    return { error: error.message };
  }
  return { error: null };
}

export function getFileName(url: string): string {
  const parts = url.split('?')[0].split('/');
  const raw = parts[parts.length - 1];
  return raw.replace(/^\d+_/, '');
}
