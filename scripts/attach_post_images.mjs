// 글 1편에 본문 이미지 붙이기 — 로컬 이미지 파일 → clinic-assets 업로드 → saved_posts.image_urls
//
// 언제 쓰나: 자체 블로그(서브도메인)에 이미지를 띄우고 싶은데 그 글의 image_urls 가
//           비어 있을 때. 2026-07-26 이전에 만든 글은 전부 여기에 해당한다
//           (그때까지 생성 이미지가 DB 에 저장되지 않았다 — fix/compliance-and-save 로 수정됨).
//
// 사용법 (앱 폴더에서):
//   1) 이미지 파일을 폴더 하나에 모으고 **본문 [이미지 N] 순서대로** 이름을 붙인다.
//        1.png  2.png  3.png  4.png  5.png     (png / jpg / jpeg / webp)
//      파일명 앞의 숫자가 본문 `[이미지 N: …]` 의 N 이다. 숫자가 곧 위치다.
//   2) 미리보기(아무것도 바꾸지 않는다):
//        node scripts/attach_post_images.mjs --post <글UUID> --dir "C:\경로\이미지폴더"
//   3) 실제 적용:
//        node scripts/attach_post_images.mjs --post <글UUID> --dir "C:\경로\이미지폴더" --apply
//
// 하는 일:
//   - 글의 소유자(user_id)를 확인하고
//   - clinic-assets/{userId}/post-images/ 에 업로드한 뒤
//   - saved_posts.image_urls 를 업로드된 public URL 배열로 채운다.
//
// 안전장치:
//   - --apply 없이는 절대 쓰지 않는다(기본 dry-run).
//   - 이미 image_urls 가 채워진 글은 --force 없이는 건드리지 않는다.
//   - 업로드 경로는 clinic-assets public 버킷 고정 — 렌더 화이트리스트
//     (src/content/lib/clinic-site/theme.ts isAllowedClinicAssetUrl)를 반드시 통과한다.
//   - 발행 상태(published_to_site)·본문·검수 리포트는 건드리지 않는다.

import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const BUCKET = 'clinic-assets'
const MAX_IMAGES = 12
const MAX_BYTES = 20 * 1024 * 1024
const EXT_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }

// ── 인자 ────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const flag = (name) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null
}
const has = (name) => argv.includes(`--${name}`)

const postId = flag('post')
const dir = flag('dir')
const apply = has('apply')
const force = has('force')

if (!postId || !dir) {
  console.error('사용법: node scripts/attach_post_images.mjs --post <글UUID> --dir <이미지폴더> [--apply] [--force]')
  process.exit(1)
}
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(postId)) {
  console.error('--post 는 글 UUID 여야 합니다.')
  process.exit(1)
}
if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
  console.error(`폴더를 찾을 수 없습니다: ${dir}`)
  process.exit(1)
}

// ── 환경 변수 (.env.local) ──────────────────────────────────────────
const envPath = path.join(process.cwd(), '.env.local')
if (!fs.existsSync(envPath)) {
  console.error('.env.local 을 찾을 수 없습니다. 앱 폴더에서 실행하세요.')
  process.exit(1)
}
const env = {}
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 .env.local 에 필요합니다.')
  process.exit(1)
}
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

// ── 파일 수집 ───────────────────────────────────────────────────────
// ★ 파일명 앞 숫자 N = 본문 [이미지 N] 의 N (순서가 아니라 **위치**다).
//   1.png, 3.png 만 있으면 2번 자리는 비운 채로 저장한다 — 당겨 채우면
//   3.png 가 본문의 [이미지 2] 설명에 붙어 엉뚱한 사진이 나간다.
const named = []
for (const name of fs.readdirSync(dir)) {
  if (!EXT_MIME[path.extname(name).toLowerCase()]) continue
  const m = /^(\d+)/.exec(name)
  if (!m) {
    console.error(`파일명이 숫자로 시작하지 않습니다: ${name}`)
    console.error('본문 [이미지 N] 의 N 을 파일명 앞에 붙이세요. 예: 1.png, 2.jpg')
    process.exit(1)
  }
  const n = Number.parseInt(m[1], 10)
  if (!Number.isFinite(n) || n < 1 || n > MAX_IMAGES) {
    console.error(`이미지 번호가 범위를 벗어났습니다(1~${MAX_IMAGES}): ${name}`)
    process.exit(1)
  }
  if (named.some((f) => f.n === n)) {
    console.error(`이미지 번호 ${n} 이 중복됩니다: ${name}`)
    process.exit(1)
  }
  named.push({ name, n })
}
named.sort((a, b) => a.n - b.n)

if (named.length === 0) {
  console.error(`이미지 파일이 없습니다(png/jpg/jpeg/webp): ${dir}`)
  process.exit(1)
}

// ── 글 조회 ─────────────────────────────────────────────────────────
const { data: post, error: postErr } = await admin
  .from('saved_posts')
  .select('id, user_id, title, content, image_urls, published_to_site')
  .eq('id', postId)
  .maybeSingle()

if (postErr) {
  console.error(`글 조회 실패: ${postErr.code} ${postErr.message}`)
  process.exit(1)
}
if (!post) {
  console.error(`글을 찾을 수 없습니다: ${postId}`)
  process.exit(1)
}

const markers = (post.content ?? '').match(/\[이미지\s*(\d+)\s*:[^\]]*\]/g) ?? []
const markerNumbers = [
  ...new Set(markers.map((m) => Number.parseInt(/\d+/.exec(m)[0], 10))),
].sort((a, b) => a - b)
console.log('── 대상 글 ────────────────────────────────')
console.log(`제목        : ${post.title}`)
console.log(`소유자      : ${post.user_id}`)
console.log(`자체블로그  : ${post.published_to_site ? '발행됨' : '미발행'}`)
console.log(`현재 image_urls : ${Array.isArray(post.image_urls) ? `${post.image_urls.length}장` : '없음'}`)
console.log(`본문 이미지 마커 : ${markers.length}개`)
markers.forEach((m, i) => console.log(`  [${i + 1}] ${m}`))
console.log('── 업로드할 파일 ─────────────────────────')
const slotCount = named[named.length - 1].n
for (let n = 1; n <= slotCount; n++) {
  const f = named.find((x) => x.n === n)
  console.log(f ? `  → [이미지 ${n}] ${f.name}` : `  → [이미지 ${n}] (비움 — 해당 마커는 렌더되지 않음)`)
}

// 개수가 아니라 **번호 집합**을 비교한다 — 개수만 같고 번호가 어긋나면
// 엉뚱한 설명 자리에 사진이 붙는데 개수 비교로는 잡히지 않는다.
if (markerNumbers.length > 0) {
  const fileNumbers = named.map((f) => f.n)
  const missing = markerNumbers.filter((n) => !fileNumbers.includes(n))
  const extra = fileNumbers.filter((n) => !markerNumbers.includes(n))
  if (missing.length > 0) {
    console.warn(`\n⚠️ 본문에는 있는데 파일이 없는 번호: ${missing.join(', ')} → 그 자리는 비어 렌더됩니다.`)
  }
  if (extra.length > 0) {
    console.warn(`\n⚠️ 본문 마커에 없는 파일 번호: ${extra.join(', ')} → 본문 끝에 붙습니다.`)
  }
} else if (markers.length === 0) {
  console.warn('\n⚠️ 본문에 [이미지 N: …] 마커가 없습니다 → 이미지는 문단 사이에 균등 배치됩니다.')
}
if (Array.isArray(post.image_urls) && post.image_urls.length > 0 && !force) {
  console.error('\n이미 image_urls 가 채워져 있습니다. 덮어쓰려면 --force 를 붙이세요.')
  process.exit(1)
}
if (!apply) {
  console.log('\n[dry-run] --apply 를 붙이면 실제로 업로드하고 image_urls 를 채웁니다.')
  process.exit(0)
}

// ── 업로드 ──────────────────────────────────────────────────────────
// 슬롯 배열 — index i 가 [이미지 i+1]. 비는 자리는 null 로 남긴다.
const urls = new Array(slotCount).fill(null)
const uploaded = [] // 실패 시 되돌리기용 objectPath 목록

const rollback = async () => {
  if (uploaded.length === 0) return
  const { error } = await admin.storage.from(BUCKET).remove(uploaded)
  console.error(
    error
      ? `⚠️ 업로드 파일 정리 실패(${uploaded.length}개 수동 삭제 필요): ${error.message}`
      : `업로드했던 파일 ${uploaded.length}개를 정리했습니다.`,
  )
}

for (const file of named) {
  const buffer = fs.readFileSync(path.join(dir, file.name))
  if (buffer.length === 0 || buffer.length > MAX_BYTES) {
    console.error(`크기 이상으로 중단: ${file.name} (${buffer.length} bytes)`)
    await rollback()
    process.exit(1)
  }
  const ext = path.extname(file.name).toLowerCase()
  const objectPath = `${post.user_id}/post-images/${crypto.randomUUID()}${ext === '.jpeg' ? '.jpg' : ext}`
  const { error: upErr } = await admin.storage.from(BUCKET).upload(objectPath, buffer, {
    contentType: EXT_MIME[ext],
    upsert: false,
    cacheControl: '3600',
  })
  if (upErr) {
    console.error(`업로드 실패: ${file.name} — ${upErr.message}`)
    await rollback()
    process.exit(1)
  }
  const { data } = admin.storage.from(BUCKET).getPublicUrl(objectPath)
  if (!data?.publicUrl) {
    console.error(`public URL 생성 실패: ${file.name}`)
    uploaded.push(objectPath)
    await rollback()
    process.exit(1)
  }
  uploaded.push(objectPath)
  urls[file.n - 1] = data.publicUrl
  console.log(`업로드 완료: [이미지 ${file.n}] ${file.name} → ${data.publicUrl}`)
}

const { error: updErr } = await admin
  .from('saved_posts')
  .update({ image_urls: urls })
  .eq('id', postId)

if (updErr) {
  console.error(`image_urls 저장 실패: ${updErr.code} ${updErr.message}`)
  await rollback()
  process.exit(1)
}

console.log(`\n완료 — image_urls ${named.length}장(자리 ${slotCount}개) 저장.`)
console.log('자체 블로그는 ISR 1시간이라 최대 1시간 뒤 반영됩니다(즉시 확인하려면 재배포).')
