import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Fail fast or log clear errors if env vars are missing during production build
if (!supabaseUrl || !supabaseAnonKey) {
  console.error("FATAL: Missing Supabase environment variables! Check your Vercel project settings.");
}

export const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

// Use actual values or safe fallbacks only for local development
const rawClient = createClient(
  supabaseUrl || 'http://localhost:54321', 
  supabaseAnonKey || 'missing-anon-key', 
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  }
);

let currentSubAccount: string | null = null;

export function setSubAccountFilter(slug: string | null) {
  currentSubAccount = slug;
}

export function getSubAccountFilter(): string | null {
  return currentSubAccount;
}

const EXCLUDED_TABLES = new Set(['profiles', 'spare_part_history']);

// Trips tables that are already separate per sub-account. The table itself keeps the
// data apart, so there is no sub_account column to filter on or to stamp on inserts.
const OWN_TRIPS_TABLES = new Set([
  'mcl_trips', 'csl_trips', 'tarmal_trips', 'pn_mashru_trips', 'mushroom_trips',
]);

function shouldFilter(table: string): boolean {
  if (EXCLUDED_TABLES.has(table) || OWN_TRIPS_TABLES.has(table)) return false;
  return currentSubAccount !== null && currentSubAccount !== 'master';
}

function stampValues(values: any, table?: string): any {
  if (table && OWN_TRIPS_TABLES.has(table)) return values;
  const sa = currentSubAccount ?? 'master';
  if (Array.isArray(values)) {
    return values.map(v => ({ ...v, sub_account: v.sub_account ?? sa }));
  }
  return { ...values, sub_account: values.sub_account ?? sa };
}

/**
 * Wraps a Supabase query builder so that any chained method calls
 * are forwarded transparently, but select/update/delete get an
 * automatic .eq('sub_account', slug) filter prepended for non-master
 * portals on non-excluded tables.
 */
function wrapBuilder(builder: any, table: string, filterApplied = false): any {
  return new Proxy(builder, {
    get(target, prop, receiver) {
      if (typeof prop === 'symbol') {
        return Reflect.get(target, prop, receiver);
      }

      const value = Reflect.get(target, prop, receiver);

      if (typeof value !== 'function') {
        return value;
      }

      return function (...args: any[]) {
        let result;
        const needsFilter = shouldFilter(table) && !filterApplied;

        if (prop === 'select' && needsFilter) {
          result = value.apply(target, args);
          result = result.eq('sub_account', currentSubAccount);
          return wrapBuilder(result, table, true);
        }

        if (prop === 'delete' && needsFilter) {
          result = value.apply(target, args);
          result = result.eq('sub_account', currentSubAccount);
          return wrapBuilder(result, table, true);
        }

        if (prop === 'update' && needsFilter) {
          result = value.apply(target, args);
          result = result.eq('sub_account', currentSubAccount);
          return wrapBuilder(result, table, true);
        }

        if (prop === 'insert') {
          result = value.call(target, stampValues(args[0], table), ...args.slice(1));
          return wrapBuilder(result, table, true);
        }

        if (prop === 'upsert') {
          result = value.call(target, stampValues(args[0], table), ...args.slice(1));
          return wrapBuilder(result, table, true);
        }

        // Default: call the method and wrap any chained builder result
        result = value.apply(target, args);

        if (result && typeof result.then === 'function') {
          return result;
        }

        if (result && typeof result === 'object') {
          return wrapBuilder(result, table, filterApplied);
        }

        return result;
      };
    },
  });
}

export const supabase = new Proxy(rawClient, {
  get(target, prop, receiver) {
    if (prop === 'from') {
      const originalFrom = Reflect.get(target, prop, receiver);
      return function (table: string) {
        const builder = originalFrom.call(target, table);
        return wrapBuilder(builder, table);
      };
    }

    const value = Reflect.get(target, prop, receiver);
    if (typeof value === 'function') {
      return value.bind(target);
    }
    return value;
  },
}) as unknown as SupabaseClient;
