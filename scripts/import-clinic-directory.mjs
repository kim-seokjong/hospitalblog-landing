// 폴백 병원 명부 적재 — NDJSON → public.clinic_directory
//
// ★ 왜 있는가.
//   홈페이지 첫 화면의 병원 조회가 행정안전부 API 하나에 걸려 있었고, 2026-07-27
//   그 API가 "성공했고 결과는 0건"을 15분간 뿜는 동안 첫 화면 전체가 죽었다.
//   행안부가 죽어도 병원을 찾아낼 **우리 소유의 명부**가 이 테이블이다.
//
// 선행:
//   ① Supabase SQL Editor 에서 마이그레이션 057 적용
//   ② python scripts/export-clinic-directory.py ... → NDJSON 생성
//
// 사용법 (앱 폴더에서):
//   node scripts/import-clinic-directory.mjs scripts/.cache/clinic-directory.ndjson          # 미리보기
//   node scripts/import-clinic-directory.mjs scripts/.cache/clinic-directory.ndjson --apply  # 실제 적재
//
// upsert 라 여러 번 돌려도 안전하다. 식별자(mng_no)가 요양기호 해시라 결정적이므로,
// 자료를 갱신해도 같은 병원은 같은 행을 덮어쓴다(기존 리드·리포트의 mng_no 가 고아가 되지 않는다).

import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'

const BATCH_SIZE = 500

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const inputPath = args.find((a) => !a.startsWith('--'))

if (!inputPath) {
  console.error('사용법: node scripts/import-clinic-directory.mjs <ndjson 경로> [--apply]')
  process.exit(1)
}

// 앱 폴더 밖에서 실행해도 동작하도록 스크립트 위치 기준으로도 찾는다.
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const envPath = [path.resolve(process.cwd(), '.env.local'), path.join(appRoot, '.env.local')].find((p) =>
  fs.existsSync(p),
)
if (!envPath) {
  console.error('.env.local 을 찾지 못했습니다.')
  process.exit(1)
}

const env = {}
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('.env.local 에 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.')
  process.exit(1)
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

/** 적재 전 최소 검증 — 깨진 행을 DB 에 넣지 않는다. */
function validate(row) {
  if (typeof row.mng_no !== 'string' || !row.mng_no.startsWith('hira:')) return '식별자 형식 오류'
  if (typeof row.name !== 'string' || row.name.length === 0) return '병원명 없음'
  if (typeof row.name_norm !== 'string' || row.name_norm.length === 0) return '정규화 이름 없음'
  if (!Array.isArray(row.subjects)) return '진료과목이 배열이 아님'
  return null
}

async function upsert(batch) {
  const { error } = await supabase.from('clinic_directory').upsert(batch, { onConflict: 'mng_no' })
  if (error) throw new Error(error.message)
}

async function main() {
  const stream = fs.createReadStream(path.resolve(inputPath), 'utf8')
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })

  let read = 0
  let invalid = 0
  let written = 0
  let batch = []
  const now = new Date().toISOString()

  for await (const line of rl) {
    const trimmed = line.trim()
    if (!trimmed) continue
    read += 1

    let row
    try {
      row = JSON.parse(trimmed)
    } catch {
      invalid += 1
      continue
    }

    const problem = validate(row)
    if (problem) {
      invalid += 1
      if (invalid <= 5) console.warn(`  건너뜀(${problem}):`, trimmed.slice(0, 120))
      continue
    }

    batch.push({ ...row, updated_at: now })
    if (batch.length >= BATCH_SIZE) {
      if (apply) await upsert(batch)
      written += batch.length
      batch = []
      if (written % 5000 === 0) console.log(`  ...${written}행`)
    }
  }

  if (batch.length > 0) {
    if (apply) await upsert(batch)
    written += batch.length
  }

  console.log(`읽음=${read} 유효=${written} 무효=${invalid} ${apply ? '적재 완료' : '(미리보기 — --apply 필요)'}`)

  if (apply) {
    const { count, error } = await supabase
      .from('clinic_directory')
      .select('mng_no', { count: 'exact', head: true })
    if (error) console.error('행 수 확인 실패:', error.message)
    else console.log(`clinic_directory 총 행 수 = ${count}`)

    const { count: daegu, error: daeguError } = await supabase
      .from('clinic_directory')
      .select('mng_no', { count: 'exact', head: true })
      .eq('province', '대구광역시')
    if (daeguError) console.error('대구 행 수 확인 실패:', daeguError.message)
    else console.log(`그중 대구광역시 = ${daegu}`)
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
