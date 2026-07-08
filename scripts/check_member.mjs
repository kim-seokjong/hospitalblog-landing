import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

// .env.local 로드
const envPath = path.resolve(process.cwd(), '.env.local');
const env = {};
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const q = process.argv[2] || '바르다';

const { data: profiles, error } = await supabase
  .from('profiles')
  .select('id,email,hospital_name,plan,plan_started_at,plan_expires_at,usage_count,created_at,updated_at')
  .ilike('hospital_name', `%${q}%`);

if (error) { console.error('profiles error', error); process.exit(1); }
console.log('=== 매칭 프로필 (%s) ===', q);
console.log(JSON.stringify(profiles, null, 2));

for (const p of profiles || []) {
  console.log('\n########## user:', p.hospital_name, p.email, p.id);

  const { data: bks } = await supabase
    .from('billing_keys')
    .select('id,plan,status,card_name,card_last4,next_billing_at,trial_until,last_charge_attempt_at,last_charge_status,failure_count,notify_sent_at,created_at,updated_at')
    .eq('user_id', p.id)
    .order('updated_at', { ascending: false });
  console.log('--- billing_keys ---');
  console.log(JSON.stringify(bks, null, 2));

  const { data: pays } = await supabase
    .from('payments')
    .select('*')
    .eq('user_id', p.id)
    .order('created_at', { ascending: false })
    .limit(10);
  console.log('--- payments (최근10) ---');
  console.log(JSON.stringify(pays, null, 2));
}

console.log('\n현재시각(UTC):', new Date().toISOString());
