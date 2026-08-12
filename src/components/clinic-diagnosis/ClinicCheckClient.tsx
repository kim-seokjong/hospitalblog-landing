'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { trackFunnel } from '@/dev/lib/funnel';
import { DIAGNOSIS_PIXEL_EVENT, trackDiagnosisOnce } from '@/dev/lib/meta-pixel';
import Logo from '@/components/landing/Logo';
import DiagnosisReportView from './DiagnosisReportView';
import ClinicCandidatePicker from './ClinicCandidatePicker';
import BlogGuessPicker from './BlogGuessPicker';
import DetailDiagnosisForm, { type DetailInput } from './DetailDiagnosisForm';
import {
  INITIAL_DIAGNOSIS_FLOW_STATE,
  MIN_CLINIC_NAME_LENGTH,
  diagnosisFlowReducer,
  isFlowBusy,
  startDiagnosisFlow,
  startLookupFlow,
  type ClinicLookupResponse,
  type DiagnosisFlowDeps,
  type DiagnosisResponse,
} from '@/content/lib/clinic-diagnosis/flow-state';
import type { ClinicCandidate } from '@/content/lib/clinic-diagnosis/types';

/**
 * 병원명 무료진단 — 전용 페이지 (모바일 최적화).
 *
 * 흐름: 병원 이름 입력 → 후보 특정(1건이면 자동, 여러 건이면 선택)
 *      → 네 축 진단 → 결과(항목마다 지금상태/왜문제/뭘해야)
 *      → 자동 탐색이 실패했거나 더 보고 싶으면 상세 진단(주소·본문 직접 입력).
 *
 * 진입: 직접 방문 외에 랜딩 첫 화면(/)에서 `?name=병원명` 으로 넘어오며,
 *      이 경우 방문자가 다시 입력할 필요 없이 진단이 자동 실행된다.
 *
 * 규칙: 라이트 랜딩 테마 명시(bg-white·text-[#202020]) — 다크 루트 상속 가드.
 *      매출·방문자 추정 금지, 타 병원 비교 금지, 의료광고법 단정 금지.
 */

const inputClass =
  'w-full px-4 py-3.5 rounded-xl border border-[#dbe2ea] bg-white text-[#202020] placeholder-[#8a93a0] focus:outline-none focus:border-[#ff4628] text-[15px]';

/** 입력창 maxLength — `?name=` 자동 실행도 같은 상한으로 자른다. */
const NAME_MAX_LENGTH = 60;
const REGION_MAX_LENGTH = 30;

export default function ClinicCheckClient() {
  const searchParams = useSearchParams();
  const [name, setName] = useState('');
  const [region, setRegion] = useState('');
  const [showRegion, setShowRegion] = useState(false);

  /**
   * ★ 퍼널 계측 (2026-07-28 신설) — 이 페이지가 측정에서 통째로 빠져 있었다.
   *
   *   anon_id 쿠키는 /api/funnel-event 가 이벤트를 받을 때만 발급된다. 그런데 이
   *   화면은 diagnosis_run·report_view 만 보냈다. 즉 **영업자료·콜드메일이 보내는
   *   바로 그 페이지의 방문자가 카운트에 없었다** — 실측 당시 "방문자 43명" 은
   *   전부 랜딩(/) 방문자였고, 영업 링크로 들어온 사람은 한 명도 집계되지 않았다.
   *   이메일 제출 4건의 anon_id 가 전부 null 이었던 것도 같은 이유다.
   *
   *   랜딩과 **같은 이벤트 이름**을 쓴다. meta 의 path 로 구분되므로 두 진입 경로를
   *   나란히 비교할 수 있다 — "영업 링크가 랜딩보다 잘 먹히는가" 를 이제 답할 수 있다.
   */
  const inputStartSentRef = useRef(false);

  useEffect(() => {
    trackFunnel('landing_view');
  }, []);

  /**
   * 조회·진단의 비동기 상태는 전부 순수 상태기(flow-state.ts)가 들고 있다.
   * 화면은 그 결과를 읽기만 한다 — 경합 가드와 로딩 해제 규칙이 한곳에 모여
   * 회귀 테스트(__tests__/flow-state.test.ts)로 검증된다.
   *
   * shareToken: 결과를 메일로 보내는 동선의 열쇠 — 서버가 이 토큰으로 리포트를 다시 읽는다.
   * ★ 토큰은 받아 두되 **공유 주소를 화면에 띄우지 않는다.**
   *   링크를 눈앞에 그대로 주면 결과를 남기는 데 이메일이 필요 없어지고,
   *   그러면 우리에게는 아무것도 남지 않는다. 결과를 나중에 다시 열거나
   *   원장께 전달하는 길은 메일 발송(DiagnosisEmailCapture)로 일원화한다 —
   *   메일 본문에 같은 /clinic-check/r/[token] 링크가 그대로 들어가므로
   *   기능이 사라지는 것은 아니다.
   */
  const [flow, dispatch] = useReducer(diagnosisFlowReducer, INITIAL_DIAGNOSIS_FLOW_STATE);
  const { lookup, lookupLoading, error, report, busyMngNo, shareToken, showDetail } = flow;
  const busy = isFlowBusy(flow);

  /**
   * 흐름 번호 발급기 — 사용자가 새로 시작한 동작에서만 올라간다.
   * 조회 → 자동 진단 구간은 같은 번호를 물려받으므로, 진단이 조회의 뒷정리를
   * 무효화해 로딩이 굳던 사고(2026-07-27)가 구조적으로 재발하지 않는다.
   */
  const flowSeqRef = useRef(0);
  /** `?name=` 자동 실행은 1회만 (재렌더·쿼리 재평가로 중복 진단이 돌지 않도록). */
  const autoRanRef = useRef(false);
  const resultRef = useRef<HTMLDivElement | null>(null);
  const regionRef = useRef<HTMLInputElement | null>(null);
  /**
   * 최신 입력값 — 실행기가 호출 시점에 읽는다.
   * 이렇게 해야 runLookup 이 타자 한 글자마다 새로 만들어지지 않고,
   * `?name=` 자동 실행 useEffect 도 의존성 변화로 다시 돌지 않는다.
   */
  const nameValueRef = useRef('');
  const regionValueRef = useRef('');
  nameValueRef.current = name;
  regionValueRef.current = region;

  const deps = useMemo<DiagnosisFlowDeps>(
    () => ({
      nextFlowId: () => ++flowSeqRef.current,
      currentFlowId: () => flowSeqRef.current,
      dispatch,
      lookupClinic: async ({ name: value, region: regionValue }) => {
        const res = await fetch('/api/clinic-diagnosis/lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: value, region: regionValue }),
        });
        const data = (await res.json()) as ClinicLookupResponse;
        // 실패 응답에 outcome 이 섞여 있어도 쓰지 않는다 — 문구만 넘긴다.
        return res.ok ? data : { error: data.error };
      },
      requestDiagnosis: async ({ clinic, detail }) => {
        const res = await fetch('/api/clinic-diagnosis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mngNo: clinic.mngNo,
            name: clinic.name,
            region: clinic.region,
            blogId: detail?.blogId || undefined,
            siteUrl: detail?.siteUrl || undefined,
            body: detail?.body || undefined,
            share: true,
          }),
        });
        const data = (await res.json()) as DiagnosisResponse;
        return res.ok ? data : { error: data.error };
      },
      // 퍼널: 진단 실행 도달 (랜딩 제출 대비 이동 중 이탈을 여기서 읽는다).
      onLookupStarted: () => {
        trackFunnel('diagnosis_run');
        // ★메타 픽셀에도 같이 보낸다 (2026-08-12).
        //   우리 광고의 도착지는 전부 무료진단인데 메타는 진단 퍼널을 하나도 못 보고
        //   있었다(붙어 있던 건 sample·pricing·가입·결제뿐). 그러면 광고를 돌려도
        //   '클릭'까지만 최적화된다 — 돈이 새는 자리다.
        //   재진단할 때마다 세지 않도록 방문당 한 번만 보낸다.
        trackDiagnosisOnce(DIAGNOSIS_PIXEL_EVENT.started, 'visit');
      },
      onReportShown: (reportToken: string | null) => {
        // 퍼널: 결과까지 실제로 도달 (진단 실행 대비 실패율을 여기서 읽는다).
        trackFunnel('diagnosis_report_view');
        // 결과 도달 = 지금 우리가 가진 유일한 '볼륨 있는' 전환 신호다.
        // 가입은 8월 0건이라 메타가 학습할 수 없다(주당 수십 건이 필요하다).
        // ⚠️블로그 후보 교체·상세 재진단마다 이 콜백이 다시 불린다 → 리포트 단위로 한 번.
        //   방문 단위로 묶으면 한 탭에서 두 번째 병원을 진단했을 때 그 성과가 통째로 빠진다.
        //   토큰은 판정에만 쓰고 **메타로 보내지 않는다**(파라미터 없음).
        trackDiagnosisOnce(DIAGNOSIS_PIXEL_EVENT.reportViewed, reportToken ?? 'no-token');
        setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
      },
    }),
    [],
  );

  /** 사용자가 병원을 직접 골라 시작하는 진단(후보 선택·블로그 교체·상세 입력). */
  const runDiagnosis = useCallback(
    (clinic: ClinicCandidate, detail?: DetailInput) => {
      void startDiagnosisFlow(deps, clinic, detail);
    },
    [deps],
  );

  /**
   * 병원 특정 → (1건이면) 진단까지 실행.
   * nameOverride 는 `?name=` 자동 실행용 — setName 직후에는 state 반영 전이라
   * 입력값을 인자로 직접 넘겨야 한 번의 사용자 행동이 두 번 필요해지지 않는다.
   */
  const runLookup = useCallback(
    (nameOverride?: string) => {
      void startLookupFlow(deps, {
        name: nameOverride ?? nameValueRef.current,
        region: regionValueRef.current,
      });
    },
    [deps],
  );

  /**
   * 랜딩 첫 화면(/)에서 넘어온 `?name=병원명` 자동 실행.
   * useSearchParams 는 이미 디코딩된 값을 반환한다(한글·공백 안전).
   * 값이 없거나 2자 미만이면 아무 일도 하지 않는다 — 직접 방문 흐름 그대로.
   */
  useEffect(() => {
    if (autoRanRef.current) return;
    const raw = searchParams.get('name')?.trim() ?? '';
    if (raw.length < MIN_CLINIC_NAME_LENGTH) return;
    autoRanRef.current = true;
    const value = raw.slice(0, NAME_MAX_LENGTH);
    setName(value);
    runLookup(value);
  }, [searchParams, runLookup]);

  const handleNeedRegion = useCallback(() => {
    setShowRegion(true);
    setTimeout(() => regionRef.current?.focus(), 60);
  }, []);

  const selectedClinic =
    report?.clinic ?? (lookup?.kind === 'resolved' ? lookup.clinic : null);

  return (
    <div className="min-h-screen bg-white text-[#202020]">
      <div className="flex h-2">
        <i className="flex-1 bg-[#ff4628]" />
        <i className="flex-1 bg-[#202020]" />
        <i className="flex-1 bg-[#b8c8d7]" />
      </div>
      <header className="sticky top-0 z-40 border-b border-[#dbe2ea] bg-white/85 backdrop-blur-md">
        <div className="max-w-4xl mx-auto px-5 sm:px-6 h-16 flex items-center justify-between">
          <a href="/" aria-label="닥터포스트 홈" className="flex items-center min-w-0">
            <Logo variant="light" />
          </a>
          <span className="text-xs sm:text-sm font-bold text-[#4a4f55]">병원 온라인 노출 무료진단</span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-5 sm:px-6 py-10 sm:py-14">
        <div className="text-center">
          <p className="text-[13px] font-extrabold text-[#ff4628] tracking-[2px]">FREE CHECK</p>
          <h1 className="text-[26px] sm:text-[40px] font-black leading-tight mt-2.5" style={{ letterSpacing: '-0.5px' }}>
            병원 이름만 넣으면
            <br className="sm:hidden" /> 온라인 노출 성적을 알려드려요
          </h1>
          <p className="text-[#4a4f55] mt-3 text-[15px] sm:text-base leading-relaxed">
            네이버 플레이스·블로그·인스타·유튜브·홈페이지·AI 검색까지
            <br className="hidden sm:block" />
            공개된 자료로 실제로 조회해서 무료로 진단해 드려요.
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            // 퍼널: 제출 도달 — 입력 시작 대비 얼마나 실제로 눌렀는지 읽는다.
            trackFunnel('diagnosis_submit');
            runLookup();
          }}
          className="mt-7 max-w-xl mx-auto"
        >
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={name}
              onChange={(e) => {
                /**
                 * 퍼널: 입력 시작 — 세션당 1회만. 타이핑마다 쌓으면 지표가 무의미해진다.
                 * ⚠️ `?name=` 자동 실행은 여기를 타지 않는다(프로그램 세팅). 랜딩에서
                 *    이미 input_start 를 보냈으므로 중복 집계되지 않는다.
                 */
                if (!inputStartSentRef.current && e.target.value.trim().length > 0) {
                  inputStartSentRef.current = true;
                  trackFunnel('diagnosis_input_start');
                }
                setName(e.target.value);
              }}
              placeholder="병원 이름 (예: 브이비성형외과의원)"
              className={inputClass}
              style={{ colorScheme: 'light' }}
              maxLength={NAME_MAX_LENGTH}
              required
            />
            <button
              type="submit"
              disabled={busy || name.trim().length < MIN_CLINIC_NAME_LENGTH}
              className="flex-shrink-0 px-7 py-3.5 bg-gradient-to-br from-[#ff4628] to-[#e63a1c] text-white font-bold rounded-xl transition-all shadow-[0_12px_30px_-14px_rgba(255,70,40,0.30)] hover:brightness-105 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
            >
              {lookupLoading ? '병원 찾는 중…' : busyMngNo ? '진단 중…' : '무료 진단하기'}
            </button>
          </div>

          {showRegion ? (
            <input
              ref={regionRef}
              type="text"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              placeholder="지역 (예: 대구광역시 수성구)"
              className={`${inputClass} mt-3`}
              style={{ colorScheme: 'light' }}
              maxLength={REGION_MAX_LENGTH}
            />
          ) : (
            <button
              type="button"
              onClick={handleNeedRegion}
              className="mt-2.5 text-[12px] text-[#5b6573] underline underline-offset-2 min-h-[44px]"
            >
              같은 이름이 많다면 지역을 함께 넣어 주세요
            </button>
          )}
        </form>

        <p className="text-[11px] text-[#8a93a0] text-center mt-2.5 leading-relaxed">
          행정안전부 공표 정보 · 네이버 공개 API · 공개된 블로그 글과 홈페이지 열람만 사용해요 · 무료
        </p>

        {busy && (
          <div className="flex items-center justify-center gap-2 py-12">
            <span className="w-5 h-5 border-2 border-[#ff4628] border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-[#5b6573]">
              {lookupLoading ? '등록된 병원 정보를 찾는 중…' : '플레이스·블로그·홈페이지·AI 검색을 실제로 조회하는 중… (최대 1분)'}
            </span>
          </div>
        )}

        {error && (
          <div className="mt-8 max-w-xl mx-auto bg-yellow-50 border border-yellow-500/30 rounded-xl px-4 py-3.5 flex items-start gap-2">
            <span className="text-yellow-600 text-sm flex-shrink-0 mt-0.5">⚠</span>
            <p className="text-sm text-yellow-700">{error}</p>
          </div>
        )}

        {lookup && !report && !lookupLoading && (
          <ClinicCandidatePicker
            outcome={lookup}
            onPick={(clinic) => runDiagnosis(clinic)}
            onNeedRegion={handleNeedRegion}
            busyMngNo={busyMngNo}
          />
        )}

        {report && !busyMngNo && (
          <div ref={resultRef} className="mt-10">
            <DiagnosisReportView report={report} shareToken={shareToken} />

            {/*
              블로그 후보 목록.
              · uncertain : 특정하지 못했다 → 골라 달라고 한다(진단은 나머지 축으로만 나갔다)
              · assumed   : 1위로 이미 진단했다 → **교체용**으로만 띄운다(흐름을 막지 않는다)
            */}
            {(report.blog.resolution.kind === 'uncertain' || report.blog.resolution.kind === 'assumed') && (
              <BlogGuessPicker
                guesses={report.blog.resolution.guesses}
                currentBlogId={report.blog.resolution.kind === 'assumed' ? report.blog.blogId : null}
                busy={busyMngNo !== null}
                onPick={(blogId) => runDiagnosis(report.clinic, { blogId, siteUrl: '', body: '' })}
              />
            )}

            {!showDetail && (
              <button
                type="button"
                onClick={() => dispatch({ type: 'detail:open' })}
                className="w-full mt-4 px-6 py-3.5 min-h-[44px] bg-[#202020] text-white font-bold rounded-xl"
              >
                더 정확하게 — 주소를 직접 넣어 상세 진단하기
              </button>
            )}
          </div>
        )}

        {showDetail && (
          <DetailDiagnosisForm
            clinic={selectedClinic}
            busy={busyMngNo !== null}
            onSubmit={(detail) => {
              if (selectedClinic) runDiagnosis(selectedClinic, detail);
            }}
          />
        )}
      </main>
    </div>
  );
}
