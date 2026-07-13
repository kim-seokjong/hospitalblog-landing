import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { isAllowedClinicflixAssetUrl } from '../clinicflix-asset-hosts.ts'

beforeEach(() => {
  delete process.env.CLINICFLIX_SERVICE_URL
})

test('fal.media 정확 일치·서브도메인 허용', () => {
  assert.equal(isAllowedClinicflixAssetUrl('https://fal.media/files/a.mp4'), true)
  assert.equal(isAllowedClinicflixAssetUrl('https://v3.fal.media/files/a.mp4'), true)
  assert.equal(isAllowedClinicflixAssetUrl('https://cdn.fal.media/img.png'), true)
})

test('supabase.co 서브도메인 허용', () => {
  assert.equal(
    isAllowedClinicflixAssetUrl('https://abc.supabase.co/storage/v1/object/public/x.png'),
    true,
  )
})

test('접미사 위장 호스트 차단 — evilfal.media·notsupabase.co류', () => {
  assert.equal(isAllowedClinicflixAssetUrl('https://evilfal.media/a.mp4'), false)
  assert.equal(isAllowedClinicflixAssetUrl('https://fal.media.evil.com/a.mp4'), false)
})

test('http(비 https)·잘못된 URL 차단', () => {
  assert.equal(isAllowedClinicflixAssetUrl('http://fal.media/a.mp4'), false)
  assert.equal(isAllowedClinicflixAssetUrl('not-a-url'), false)
})

test('env 미설정 시 Railway 호스트 전면 차단 (와일드카드 제거 회귀 방지)', () => {
  assert.equal(isAllowedClinicflixAssetUrl('https://anything.up.railway.app/a.mp4'), false)
})

test('env 설정 시 그 호스트만 허용, 다른 Railway 앱은 차단', () => {
  process.env.CLINICFLIX_SERVICE_URL = 'https://clinicflix-prod.up.railway.app'
  assert.equal(isAllowedClinicflixAssetUrl('https://clinicflix-prod.up.railway.app/a.mp4'), true)
  assert.equal(isAllowedClinicflixAssetUrl('https://attacker-app.up.railway.app/a.mp4'), false)
})

test('env 스킴 누락 시에도 호스트 파싱 (baseUrl 과 동일 보정)', () => {
  process.env.CLINICFLIX_SERVICE_URL = 'clinicflix-prod.up.railway.app'
  assert.equal(isAllowedClinicflixAssetUrl('https://clinicflix-prod.up.railway.app/a.mp4'), true)
})
