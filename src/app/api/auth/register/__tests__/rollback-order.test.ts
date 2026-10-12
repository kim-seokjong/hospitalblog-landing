// 회원가입 라우트의 계정 삭제(롤백)·프로필 저장이 안전 검사 뒤에만 오는지 고정한다 — 2026-10-12.
//
// 배경: 이 라우트는 로그인 없이 호출된다. 필수 항목 검사가 맨 앞에서 deleteUser 를 불러,
//   남의 userId 만 넣고 필드를 비우면 기존 회원 계정이 지워질 수 있었다(Codex 지적·실코드 확인, 7ff2815).
//   재검토에서 ①catch 경로 삭제가 검사를 우회 ②요청자가 가입자인지 확인 안 함 이 추가로 나왔다.
// 라우트는 Supabase·Next 에 묶여 있어 직접 돌리기 어렵다 ⇒ 소스의 순서와 조건을 검사한다.
//   ⚠️route 파일은 GET/POST 외 export 가 금지라(빌드 실패) 헬퍼를 꺼내 단위 시험하지 않는다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const src = readFileSync(path.join(here, '..', 'route.ts'), 'utf8')
// 함수 본문(POST) 안만 본다 — 위쪽 헬퍼 정의·주석이 순서 판정을 흐리지 않게.
const body = src.slice(src.indexOf('export async function POST'))

function at(needle: string): number {
  const i = body.indexOf(needle)
  assert.ok(i >= 0, `POST 본문에 「${needle}」 가 없다 — 검사 대상이 바뀌었으면 이 시험도 함께 고친다`)
  return i
}

const gates = {
  exists: at('auth.admin.getUserById(userId)'),
  window: at('ageMs > SIGNUP_WINDOW_MS'),
  profile: at('existing?.full_name'),
  nonce: at('checkRegistrationNonce('),
  allow: at('rollbackAllowed = true'),
}

test('가입자 확인 번호 검사는 존재·시간 창·프로필 검사 뒤, 롤백 허용 표시보다 앞', () => {
  assert.ok(gates.nonce > Math.max(gates.exists, gates.window, gates.profile))
  assert.ok(gates.allow > gates.nonce, '롤백 허용 표시가 번호 검사보다 앞에서 켜진다')
  assert.equal(body.split('rollbackAllowed = true').length - 1, 1, '롤백 허용 표시를 켜는 곳은 한 곳뿐이어야 한다')
})

test('try 본문의 모든 deleteUser·프로필 upsert 는 롤백 허용 표시 뒤에만 나온다', () => {
  const tryEnd = at('} catch (e) {')
  const deletes = [...body.slice(0, tryEnd).matchAll(/auth\.admin\.deleteUser\(/g)].map((m) => m.index ?? -1)
  assert.ok(deletes.length > 0, 'try 본문에서 deleteUser 를 찾지 못했다')
  for (const d of deletes) assert.ok(d > gates.allow, `deleteUser(위치 ${d})가 롤백 허용 표시보다 앞에 있다`)
  assert.ok(at(".upsert(profileRow") > gates.allow, '프로필 저장이 가입자 확인보다 앞에 있다')
})

test('catch 경로의 삭제는 한 곳뿐이고 롤백 허용 표시를 요구한다', () => {
  const catchPart = body.slice(at('} catch (e) {'))
  const calls = catchPart.split('auth.admin.deleteUser(').length - 1
  assert.equal(calls, 1, `catch 경로의 deleteUser 가 ${calls}곳 — 하나뿐이어야 모두 같은 조건 아래 있다고 보장된다`)
  const cond = catchPart.slice(0, catchPart.indexOf('auth.admin.deleteUser('))
  assert.match(cond, /if \(userId && supabaseAdmin && rollbackAllowed && !profileCommitted\)/,
    'catch 의 deleteUser 앞 조건에 rollbackAllowed 가 없다 — 검사 도중 예외로 남의 계정이 지워질 수 있다')
})

test('메타데이터에는 번호 원본이 아니라 해시만 둔다(미확인 계정 중복 signUp 이 메타데이터를 돌려준다)', () => {
  const modal = readFileSync(path.join(here, '..', '..', '..', '..', '..', 'hr', 'components', 'AuthModal.tsx'), 'utf8')
  assert.match(modal, /options: \{ data: \{ registration_nonce_hash: registrationNonceHash \} \}/)
  assert.doesNotMatch(modal, /data: \{ registration_nonce: /)
  assert.match(src, /user_metadata\?\.registration_nonce_hash/)
})

test('프로필 조회가 실패하면 지우지 않고 503 으로 멈춘다', () => {
  assert.match(body, /if \(existingErr\)[\s\S]{0,300}status: 503/)
  assert.ok(at('if (existingErr)') < gates.allow)
})
