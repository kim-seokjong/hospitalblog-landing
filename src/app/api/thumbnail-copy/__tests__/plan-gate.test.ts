// 썸네일 카피 라우트가 Claude 를 부르기 전에 플랜 가드를 거치고, 부속 기능 상한이 세는 로그를 남기는지 고정한다 — 2026-10-20.
//
// 배경(W43 Codex 지적·실코드 확인): 이 라우트만 로그인 여부만 보고 Claude 를 불러,
//   무료 체험을 다 쓴 계정·만료 계정이 횟수 제한 없이 썼다(b1091ee 「부속 기능 무제한 차단」의 구멍).
// 라우트는 Supabase·Next 에 묶여 있어 직접 돌리기 어렵다 ⇒ 소스의 순서와 이름을 검사한다(rollback-order.test.ts 와 같은 방식).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { FREE_TRIAL_ACCESSORY_FEATURES } from '../../../../payment/lib/free-trial-gate.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const src = readFileSync(path.join(here, '..', 'route.ts'), 'utf8')
const body = src.slice(src.indexOf('export async function POST'))
const logger = readFileSync(path.join(here, '..', '..', '..', '..', 'dev', 'lib', 'usage-logger.ts'), 'utf8')

test('Claude 호출(suggestThumbnailCopy) 전에 requirePaidPlan 결과로 막는다', () => {
  const gate = body.indexOf('await requirePaidPlan()')
  const reject = body.indexOf('if (!gate.ok)')
  const call = body.indexOf('suggestThumbnailCopy(')
  assert.ok(gate >= 0, 'requirePaidPlan 호출이 없다')
  assert.ok(reject > gate, '가드 결과로 거절하는 분기가 없다')
  assert.ok(call > reject, 'Claude 호출이 가드보다 앞에 있다')
})

test('사용 로그 feature 가 부속 기능 상한 목록과 FeatureType 에 모두 있다', () => {
  const m = body.match(/feature:\s*'([^']+)'/)
  assert.ok(m, 'logUsage feature 가 없다')
  const feature = m[1]
  assert.ok((FREE_TRIAL_ACCESSORY_FEATURES as readonly string[]).includes(feature),
    `${feature} 가 FREE_TRIAL_ACCESSORY_FEATURES 에 없으면 무료 체험 상한이 세지 않는다`)
  assert.ok(logger.includes(`| '${feature}'`), `${feature} 가 usage-logger FeatureType 에 없다`)
  assert.ok(body.includes('user_id: gate.userId'), '로그에 사용자 id 가 없으면 계정별 상한이 서지 않는다')
})
