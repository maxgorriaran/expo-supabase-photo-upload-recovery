import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { BUCKET, type Remote, type RemoteRecord } from '../core/types';

export const limitedFetch: typeof fetch = async (input, init) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  const upstream = init?.signal;
  const abort = () => controller.abort();
  upstream?.addEventListener('abort', abort, { once: true });
  if (upstream?.aborted) controller.abort();
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    upstream?.removeEventListener('abort', abort);
  }
};
function record(raw: {
  id: string;
  owner_id: string;
  object_path: string;
  state: string;
}): RemoteRecord {
  if (raw.state !== 'ready' && raw.state !== 'deleted') throw new Error('Invalid remote state.');
  return { id: raw.id, ownerId: raw.owner_id, objectPath: raw.object_path, state: raw.state };
}

/** Freeze the bearer token for this operation. A later sign-in cannot redirect a held upload. */
export function supabaseRemote(
  url: string,
  key: string,
  owner: string,
  accessToken: string,
  verifyUri: (uri: string) => Promise<void>,
): Remote {
  const client: SupabaseClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` }, fetch: limitedFetch },
  });
  const check = (p: { ownerId: string }) => {
    if (p.ownerId !== owner) throw new Error('Account mismatch.');
  };
  const bucket = client.storage.from(BUCKET);
  const columns = 'id,owner_id,object_path,state';
  return {
    readRecord: async (p) => {
      check(p);
      const { data, error } = await client
        .from('photo_saves')
        .select(columns)
        .eq('id', p.id)
        .maybeSingle();
      if (error) throw error;
      return data ? record(data) : null;
    },
    inspectObject: async (p) => {
      check(p);
      const filename = `${p.id}.jpg`;
      const { data, error } = await bucket.list(owner, { search: filename, limit: 2 });
      if (error) throw error;
      const found = data?.find((item) => item.name === filename);
      if (!found) return null;
      return {
        byteLength: Number(found.metadata?.size),
        contentType: String(found.metadata?.mimetype),
      };
    },
    upload: async (p, bytes) => {
      check(p);
      // ArrayBuffer is the documented React Native path; no FormData, Blob, or implicit overwrite.
      const { error } = await bucket.upload(p.objectPath, Uint8Array.from(bytes).buffer, {
        contentType: 'image/jpeg',
        upsert: false,
      });
      if (error) throw error;
    },
    verifyImage: async (p) => {
      check(p);
      const { data, error } = await bucket.createSignedUrl(p.objectPath, 60);
      if (error) throw error;
      await verifyUri(data.signedUrl);
    },
    insertRecord: async (p) => {
      check(p);
      const { data, error } = await client
        .from('photo_saves')
        .insert({ id: p.id, owner_id: owner, state: 'ready' })
        .select(columns)
        .single();
      if (error) throw error;
      return record(data);
    },
    markDeleted: async (p) => {
      check(p);
      const { data, error } = await client
        .from('photo_saves')
        .upsert({ id: p.id, owner_id: owner, state: 'deleted' }, { onConflict: 'id' })
        .select(columns)
        .single();
      if (error) throw error;
      return record(data);
    },
  };
}
