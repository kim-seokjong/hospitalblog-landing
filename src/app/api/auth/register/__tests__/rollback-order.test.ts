// 회원가입 라우트의 계정 삭제(롤백)가 안전 검사 뒤에만 오는지 고정한다 — 2026-10-12.
//
// 배경: 이 라우트는 로그인 없이 호출된다. 필수 항목 검사가 맨 앞에서 deleteUser 를 불러,
//   남의 userId 만 넣고 필드를 비우면 기존 회원 계정이 지워질 수 있었다(Codex 지적·실코드 확인).
// 라우트는 Supabase·Next 에 묶여 있어 직접 돌리기 어렵다 ⇒ 소스 순서를 검사한다.
//   deleteUser 가 나오는 모든 자리는 ①getUserById ②가입 시간 창 ③기존 프로필 검사보다 뒤여야 한다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const src = readFileSync(path.join(here, '..', 'route.ts'), 'utf8')

function firstIndex(needle: string): number {
  const i = src.indexOf(needle)
  assert.ok(i >= 0, `route.ts 에 「${needle}」 가 없다 — 검사 대상이 바뀌었으면 이 시험도 함께 고친다`)
  return i
}

test('deleteUser 는 존재·시간 창·기존 프로필 검사보다 뒤에만 나온다', () => {
  const gates = [
    firstIndex('auth.admin.getUserById(userId)'),
    firstIndex('SIGNUP_WINDOW_MS'.concat(')')),
    firstIndex("existing?.full_name"),
  ]
  const lastGate = Math.max(...gates)
  const deletes = [...src.matchAll(/auth\.admin\.deleteUser\(/g)].map((m) => m.index ?? -1)
  assert.ok(deletes.length > 0, 'deleteUser 호출을 찾지 못했다')
  for (const d of deletes) {
    assert.ok(d > lastGate, `deleteUser(위치 ${d})가 안전 검사(마지막 위치 ${lastGate})보다 앞에 있다`)
  }
})

test('프로필 조회가 실패하면 지우지 않고 멈춘다', () => {
  assert.match(src, /if \(existingErr\)[\s\S]{0,300}status: 503/)
})
