import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { countFieldValues, isHobbySafeCron, runsPerDay } from '../cron-frequency.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
/** src/dev/lib/__tests__ → 저장소 루트 */
const REPO_ROOT = join(HERE, '..', '..', '..', '..');

test('필드 값 개수 — 기본 문법', () => {
  assert.equal(countFieldValues('*', 0, 59), 60);
  assert.equal(countFieldValues('0', 0, 59), 1);
  assert.equal(countFieldValues('0,30', 0, 59), 2);
  assert.equal(countFieldValues('1-5', 0, 23), 5);
  assert.equal(countFieldValues('*/30', 0, 59), 2);
  assert.equal(countFieldValues('0-23/2', 0, 23), 12);
});

test('해석할 수 없는 필드는 범위 전체로 본다 — 모르는 문법을 통과시키지 않는다', () => {
  assert.equal(countFieldValues('L', 0, 23), 24);
  assert.equal(countFieldValues('', 0, 59), 60);
  assert.equal(countFieldValues('5-1', 0, 23), 24); // 뒤집힌 범위
});

test('하루 실행 횟수', () => {
  assert.equal(runsPerDay('0 18 * * *'), 1);
  assert.equal(runsPerDay('30 18 * * *'), 1);
  assert.equal(runsPerDay('0 1 * * 1'), 1); // 주 1회도 하루 기준 1
  assert.equal(runsPerDay('0 * * * *'), 24);
  assert.equal(runsPerDay('*/30 * * * *'), 48);
});

test('필드 수가 5개가 아니면 Infinity — 조용히 통과시키지 않는다', () => {
  assert.equal(runsPerDay('0 18 * *'), Number.POSITIVE_INFINITY);
  assert.equal(runsPerDay('0 18 * * * *'), Number.POSITIVE_INFINITY);
});

test('Hobby 안전 판정', () => {
  assert.equal(isHobbySafeCron('0 23 * * *'), true);
  assert.equal(isHobbySafeCron('0 * * * *'), false);
});

/**
 * ★ 이 프로젝트를 지키는 진짜 검사.
 *
 * 2026-07-27 에 `0 * * * *` 를 vercel.json 에 넣은 뒤 9개 커밋이 전부 배포 실패했다.
 * 로컬 빌드·tsc·기존 테스트가 모두 통과해서 아무도 몰랐고, 프로덕션만 조용히
 * 어제 버전에 멈춰 있었다. Vercel Hobby 는 하루 2회 이상 도는 cron 을
 * **배포 단계에서** 거부한다.
 *
 * 플랜을 Pro 로 올리면 이 테스트를 지워도 된다 — 그때는 분 단위까지 허용된다.
 */
test('vercel.json 의 모든 cron 은 하루 1회 이하다 — Hobby 플랜 배포 조건', () => {
  const raw = readFileSync(join(REPO_ROOT, 'vercel.json'), 'utf8');
  const config = JSON.parse(raw) as { crons?: { path: string; schedule: string }[] };
  const crons = config.crons ?? [];

  assert.ok(crons.length > 0, 'vercel.json 에 cron 이 하나도 없다 — 경로가 틀렸을 것이다');

  const violations = crons
    .filter((c) => !isHobbySafeCron(c.schedule))
    .map((c) => `${c.path} = "${c.schedule}" (하루 ${runsPerDay(c.schedule)}회)`);

  assert.deepEqual(
    violations,
    [],
    `Vercel Hobby 는 하루 1회 cron 만 허용한다. 아래 표현식은 배포를 실패시킨다:\n  ${violations.join('\n  ')}\n` +
      '시간당 감시가 필요하면 Vercel Pro 로 올리거나 Railway 스케줄러에서 호출해라.',
  );
});
