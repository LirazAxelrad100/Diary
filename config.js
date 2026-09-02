// Where to find these in Supabase:
//   SUPABASE_URL      Settings → Data API → Project URL
//   SUPABASE_ANON_KEY Settings → API Keys → Publishable key (sb_publishable_…)
//
// Never put a key from the "Secret keys" section here.
//
// Yes, these are committed to a public repo, and that is fine: the publishable
// key is designed to be public in browser apps. It grants nothing on its own —
// the `entries` table is protected by row level security, so a row is only
// readable by the signed-in account that owns it. Your password is what
// protects the diary, not this key.
//
// Until these are filled in, the app runs local-only in this browser.

const SUPABASE_URL = "https://adytbgjgsncylyxzonmk.supabase.co/rest/v1/";
const SUPABASE_ANON_KEY = "sb_publishable_YxNR7MOktLtu4RKu4roxPQ_hsyLXGnq";
